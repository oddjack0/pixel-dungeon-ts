/**
 * Wand system — exact port of `items/wands/` (Wand.java + the 13 wand
 * classes), watabou/pixel-dungeon (GPL-3.0, (C) 2012-2015 Oleg Dolya).
 *
 * Pure formulas (charges, power(), Ballistica, per-wand rolls) live in
 * `src/mechanics/wands.ts`. This module owns the mutable per-instance
 * state (level, charges, 40-use identification counter, recharge clock),
 * the item-catalog bridge for instance ids (`wand_of_firebolt#3`), the
 * zap targeting flow (Wand.zapper), all 13 onZap effects, and the
 * Wandmaker reward creation.
 *
 * Identification labels use Worker 4's shared ItemStatusHandler
 * (src/content/identification.ts): registerWandClasses() is called at
 * module load with the Wand.java class order, wood labels, and sprite
 * pool. The Wandmaker section of src/content/npcs.ts consumes
 * createWandReward().
 */

import { Terrain } from '../core/grid.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import {
  USAGES_TO_KNOW,
  WAND_SPECS,
  TXT_FIZZLES,
  TXT_NOTHING_HAPPENED,
  TXT_SELF_TARGET,
  avalancheCastDistance,
  avalancheDamage,
  avalancheParalysisDuration,
  avalancheParalyzes,
  avalancheSize,
  ballisticaCast,
  blinkDestinationCell,
  buildDistanceMap,
  disintegrationDamage,
  disintegrationMaxDistance,
  fireboltDamage,
  flockLifespan,
  flockSheepCount,
  flockSheepPositions,
  lightningChainDamage,
  lightningInitialDamage,
  magicMissileDamage,
  poisonWandDuration,
  reachDistance,
  regrowthSeedAmount,
  amokDuration as amokWandDuration,
  txtReachTransported,
  txtWandIdentified,
  wandMaxCharges,
  wandMeleeMax,
  wandMeleeMin,
  wandPower,
  wandRechargeTurns,
  wandSpec,
  type BallisticaResult,
  type BallisticaWorld,
  type WandSpec,
} from '../mechanics/wands.js';
import {
  BURNING_DURATION,
  elementsDurationFactor,
  slowDuration,
  vertigoDuration,
  type BuffKind,
} from '../mechanics/buffs.js';
import { applyDamage } from '../mechanics/combat.js';
import {
  Blob,
  isFlamableForBlob,
  seedBlob,
  type BlobKind,
  type BlobWorld,
} from '../mechanics/blobs.js';
import { pressTrapCell, type TrapChar } from '../mechanics/traps.js';
import {
  getItem,
  parseItemId,
  type ItemDef,
} from './items.js';
import {
  isWandKnown as idIsWandKnown,
  knowWand as idKnowWand,
  registerWandClasses,
  resetIdentification,
  wandImage as idWandImage,
  wandLabel as idWandLabel,
} from './identification.js';
import {
  addToInventory,
  ContentHero,
} from './hero.js';
import {
  buildMob,
  charAtPos,
  damageMobDirect,
  heroOf,
  nextMobId,
  ContentMob,
  type MobDef,
} from './mobs.js';
import {
  isRingId,
  normalizeRingPickup,
  parseRingId,
  powerRingBonus,
  ringItemDefFor,
} from './rings.js';
import type { ActionContext } from '../engine/seams.js';
import type { Level } from '../dungeon/level.js';

/* ------------------------------------------------------------------ */
/* Wand instance state                                                 */
/* ------------------------------------------------------------------ */

/**
 * Per-instance wand state (Wand.java instance fields). The static catalog
 * (items.ts) cannot hold this, so instances live here keyed by instance
 * id `wand_of_<id>#<seq>`. Wand.java: curCharges, curChargeKnown,
 * maxCharges, usagesToKnow; level/levelKnown come from Item.
 */
export interface WandState {
  instanceId: string;
  /** Short wand id, e.g. 'firebolt'. */
  wandId: string;
  /** Upgrade level (Item.level). */
  level: number;
  curCharges: number;
  maxCharges: number;
  /** Counts DOWN from 40; at 0 the wand type is identified (Wand.java:56). */
  usagesToKnow: number;
  /** Charge count is player-visible (curChargeKnown, Wand.java:75). */
  chargeKnown: boolean;
  /** Per-instance Charger accumulator in time units (Charger.java). */
  rechargeAcc: number;
}

const wandStates = new Map<string, WandState>();
let wandSeq = 0;

/** Clear all wand state (new run / tests). */
export function resetWandState(): void {
  wandStates.clear();
  wandSeq = 0;
  resetIdentification();
  registerWandIdClasses();
}

/**
 * Register the wand family with Worker 4's ItemStatusHandler
 * (ItemStatusHandler.java; Dungeon.java:78-85). Called at module load and
 * from resetWandState() after resetIdentification(). Boot must call
 * initIdentification() after all workers registered.
 */
export function registerWandIdClasses(): void {
  const randomized = WAND_SPECS.filter((s) => s.id !== 'magic_missile');
  registerWandClasses({
    classes: randomized.map((s) => s.className),
    labels: WAND_WOODS,
    images: randomized.map((s) => s.sprite),
  });
}

/** Parse a wand instance id (`wand_of_firebolt#3`) or base id. */
export function parseWandId(
  itemId: string,
): { wandId: string; instanceId: string | null } | null {
  const hash = itemId.indexOf('#');
  const base = hash === -1 ? itemId : itemId.slice(0, hash);
  if (!base.startsWith('wand_of_')) return null;
  const wandId = base.slice('wand_of_'.length);
  if (!WAND_SPECS.some((s) => s.id === wandId)) return null;
  return {
    wandId,
    instanceId: hash === -1 ? null : itemId,
  };
}

/** True for any wand id (base or instance). */
export function isWandId(itemId: string): boolean {
  return parseWandId(itemId) !== null;
}

/** Fetch live instance state; undefined when the id is not an instance. */
export function getWandState(instanceId: string): WandState | undefined {
  return wandStates.get(instanceId);
}

/**
 * Create a wand instance (Wand constructor + random()/upgrade()).
 * - `randomize`: Wand.random() — 50% +1, then nested 15% +1 more.
 * - `upgrades`: explicit extra upgrades (Wandmaker rewards: the quest
 *   calls random().upgrade() — guaranteed +1 on top of the random roll).
 * Returns the instance item id for the inventory.
 */
export function createWand(
  rng: MechanicsRng,
  wandId: string,
  opts: { randomize?: boolean; upgrades?: number } = {},
): string {
  const spec = wandSpec(wandId);
  const instanceId = `wand_of_${wandId}#${++wandSeq}`;
  let level = 0;
  if (opts.randomize) {
    if (rng.float(0, 1) < 0.5) {
      level++;
      if (rng.float(0, 1) < 0.15) level++;
    }
  }
  level += opts.upgrades ?? 0;
  const maxCharges = wandMaxCharges(spec.initialCharges, level);
  wandStates.set(instanceId, {
    instanceId,
    wandId,
    level,
    curCharges: maxCharges,
    maxCharges,
    usagesToKnow: USAGES_TO_KNOW,
    chargeKnown: false,
    rechargeAcc: 0,
  });
  return instanceId;
}

/** Upgrade a wand instance (Wand.upgrade -> updateLevel). */
export function upgradeWand(instanceId: string): void {
  const st = wandStates.get(instanceId);
  if (!st) return;
  const spec = wandSpec(st.wandId);
  st.level++;
  st.maxCharges = wandMaxCharges(spec.initialCharges, st.level);
  st.curCharges = Math.min(st.curCharges + 1, st.maxCharges);
  st.chargeKnown = true; // Wand.updateLevel: curChargeKnown = true
}

/**
 * Effective level for formulas (Item.effectiveLevel; M1 has no
 * degradation/broken model, so it is the plain level).
 */
export function wandEffectiveLevel(state: WandState): number {
  return state.level;
}

/**
 * Wand.power() for a zap (Wand.java:154-165): effectiveLevel adjusted by
 * the bearer's RingOfPower buff when the wand is charging (in inventory).
 */
export function wandZapPower(
  hero: ContentHero,
  state: WandState,
  charging: boolean,
): number {
  const eLevel = wandEffectiveLevel(state);
  return wandPower(eLevel, powerRingBonus(hero), charging);
}

/** Melee damage range for a wand used as a weapon (Wand.min/max). */
export function wandMeleeRange(state: WandState): { min: number; max: number } {
  const eLevel = wandEffectiveLevel(state);
  return { min: wandMeleeMin(eLevel), max: wandMeleeMax(eLevel) };
}

/* ------------------------------------------------------------------ */
/* Item-catalog bridge                                                 */
/* ------------------------------------------------------------------ */

/**
 * The 12 random wood labels for unidentified wands (Wand.java wood
 * array, exact order). Magic Missile is excluded from the handler
 * (always type-known, fixed sprite).
 */
export const WAND_WOODS = [
  'holly',
  'yew',
  'ebony',
  'cherry',
  'teak',
  'rowan',
  'ash',
  'birch',
  'willow',
  'oak',
  'elm',
  'elder',
];

/**
 * Catalog display name (Wand.java:77-88):
 * known -> "Wand of X"; unknown -> "<wood> wand".
 * Level suffix (Item.toString, Item.java) is appended by the UI layer.
 */
export function wandDisplayName(wandId: string): string {
  const spec = wandSpec(wandId);
  if (spec.wood === null) return spec.name;
  if (idIsWandKnown(spec.className)) return spec.name;
  return `${idWandLabel(spec.className)} wand`;
}

/**
 * Catalog description (Wand.java:91-95): known -> the wand's own desc;
 * unknown -> "This wand is of a type you don't know yet." (Wand.TXT_UNKNOWN).
 */
export function wandDisplayDesc(wandId: string): string {
  const spec = wandSpec(wandId);
  if (spec.wood === null || idIsWandKnown(spec.className)) return spec.desc;
  return 'This wand is of a type you don\u2019t know yet.';
}

/**
 * Catalog sprite key. Known (or always-known) wands use their true
 * sprite; unknown wands use the handler-assigned random wand image
 * (ItemStatusHandler.image).
 */
export function wandDisplaySprite(wandId: string): string {
  const spec = wandSpec(wandId);
  if (spec.wood === null) return spec.sprite;
  if (idIsWandKnown(spec.className)) return spec.sprite;
  return idWandImage(spec.className);
}

/** Wand price (Item.price -> Wand.price: level * 20; base price 0). */
export function wandPrice(state: WandState): number {
  return Math.max(0, state.level * 20);
}

/**
 * Build the dynamic ItemDef for a wand instance id
 * (e.g. `wand_of_firebolt#3`). Served through the items.ts catalog
 * fallback registered at module load below.
 */
export function wandItemDef(instanceId: string): ItemDef | null {
  const parsed = parseWandId(instanceId);
  if (!parsed || !parsed.instanceId) return null;
  const st = wandStates.get(parsed.instanceId);
  if (!st) return null;
  const spec = wandSpec(st.wandId);
  return {
    id: parsed.instanceId,
    name: wandDisplayName(st.wandId),
    desc: wandDisplayDesc(st.wandId),
    sprite: wandDisplaySprite(st.wandId),
    type: 'misc',
    stackable: false,
    price: wandPrice(st),
  };
}

/** Normalize a pickup: bare base ids get a fresh instance (randomized). */
export function normalizeWandPickup(
  rng: MechanicsRng,
  itemId: string,
): string {
  const parsed = parseWandId(itemId);
  if (!parsed) return itemId;
  if (parsed.instanceId) return parsed.instanceId;
  return createWand(rng, parsed.wandId, { randomize: true });
}

/* ------------------------------------------------------------------ */
/* Identification helpers                                              */
/* ------------------------------------------------------------------ */

/** True when the wand's TYPE is known (Wand.known). */
export function isWandTypeKnown(wandId: string): boolean {
  const spec = wandSpec(wandId);
  return spec.wood === null || idIsWandKnown(spec.className);
}

/**
 * Mark a wand type as known (Wand.setKnown -> ItemStatusHandler.know).
 * Vanilla also does GLog.i(TXT_IDENTIFY % true name). The caller passes
 * a log function so this module stays UI-free.
 */
export function identifyWandType(
  wandId: string,
  log: (msg: string) => void = () => {},
): void {
  const spec = wandSpec(wandId);
  if (spec.wood === null || idIsWandKnown(spec.className)) return;
  idKnowWand(spec.className);
  log(txtWandIdentified(spec.name));
}

/* ------------------------------------------------------------------ */
/* Recharge (Wand.Charger)                                             */
/* ------------------------------------------------------------------ */

/**
 * Advance the wand's recharge clock by `timeUnits` (Wand.Charger.act).
 * Returns the number of charges gained. A wand whose maxCharges is 0
 * (none in vanilla) would detach the charger.
 */
export function rechargeWand(
  hero: ContentHero,
  state: WandState,
  timeUnits: number,
  mageClass: boolean,
): number {
  if (state.curCharges >= state.maxCharges) {
    state.rechargeAcc = 0;
    return 0;
  }
  const delay = wandRechargeTurns(mageClass, wandEffectiveLevel(state));
  state.rechargeAcc += timeUnits;
  let gained = 0;
  while (state.rechargeAcc >= delay && state.curCharges < state.maxCharges) {
    state.rechargeAcc -= delay;
    state.curCharges++;
    gained++;
  }
  return gained;
}

/* ------------------------------------------------------------------ */
/* Zap targeting (Wand.zapper)                                         */
/* ------------------------------------------------------------------ */

/** Result of attempting to zap a wand. */
export type ZapResult =
  | { ok: true; spent: number }
  | { ok: false; reason: 'no-charges' | 'self-target' | 'no-target' | 'unknown' };

/**
 * Begin a zap: Wand.execute calls setKnown() BEFORE checking charges
 * (Wand.java:123-126), so even an empty wand is identified when used.
 * Returns false when the zap fizzles (still costs 1 turn).
 */
export function beginZap(
  ctx: Pick<ActionContext, 'log'>,
  hero: ContentHero,
  state: WandState,
): { fizzled: boolean } {
  identifyWandType(state.wandId, ctx.log);
  if (state.curCharges <= 0) {
    ctx.log(TXT_FIZZLES);
    return { fizzled: true };
  }
  return { fizzled: false };
}

/**
 * Resolve a zap at a target cell (Wand.zapper.onSelect). `targetCell`
 * must be a map position; targeting the hero's own cell is rejected
 * (Wand.zapper: "You can't target yourself").
 *
 * Successful zaps: curCharges--, usagesToKnow--, identify at 40 uses
 * (Wand.zapProc -> usagesToKnow-- -> if (usagesToKnow == 0) setKnown()).
 */
export function resolveZap(
  ctx: ActionContext,
  hero: ContentHero,
  state: WandState,
  targetCell: number,
  fx: WandFx,
): ZapResult {
  if (targetCell === hero.pos) {
    ctx.log(TXT_SELF_TARGET);
    return { ok: false, reason: 'self-target' };
  }
  const spec = wandSpec(state.wandId);
  // Vanilla zapper.onSelect: Ballistica.cast(from, to, magic=true, hitChars).
  const ball = ballisticaCast(
    ballisticaWorldOf(ctx),
    hero.pos,
    targetCell,
    true,
    spec.hitChars,
  );
  applyZapEffect(ctx, hero, state, ball, fx);
  state.curCharges--;
  state.chargeKnown = true; // updateQuickslot (Wand.java:135)
  state.usagesToKnow--;
  if (state.usagesToKnow <= 0) identifyWandType(state.wandId, ctx.log);
  return { ok: true, spent: 1 };
}

/**
 * Roll the Wandmaker quest's reward state at QUEST SPAWN (WandMaker.Quest
 * spawnQuest): each choice wand is random().upgrade() — guaranteed +1 on
 * top of the random roll — so the level/seed roll happens now, not at
 * selection time.
 */
export function createWandReward(
  rng: MechanicsRng,
  wandId: string,
): string {
  return createWand(rng, wandId, { randomize: true, upgrades: 1 });
}

/* ------------------------------------------------------------------ */
/* Zap visual events                                                    */
/* ------------------------------------------------------------------ */

/**
 * Visual events emitted by zap effects. The renderer (engine-owned)
 * plays them; content stays UI-free. `cells` are map positions.
 */
export type WandFxEvent =
  | { kind: 'beam'; cells: number[] }
  | { kind: 'missile'; from: number; to: number }
  | { kind: 'strike'; points: number[] }
  | { kind: 'burst'; cells: number[] }
  | { kind: 'sheep'; cells: number[] };

export type WandFx = (ev: WandFxEvent) => void;

/** No-op sink for headless use (tests, sim). */
export const WandFxNoop: WandFx = () => {};

/* ------------------------------------------------------------------ */
/* Beam terrain rules                                                   */
/* ------------------------------------------------------------------ */

/**
 * Vanilla `Level.passable[c] || Level.avoid[c]` mapped onto the port's
 * Terrain set. Floors, grass, water, doors (open or closed), wells,
 * walkways, stairs and traps (hidden or revealed) let the beam through;
 * walls, chasms, secret doors, barricades and furniture block it before
 * the cell (Ballistica.java:116-118).
 */
function beamPassable(t: Terrain): boolean {
  switch (t) {
    case Terrain.WALL:
    case Terrain.CHASM:
    case Terrain.DOOR_SECRET:
    case Terrain.DOOR_LOCKED:
    case Terrain.EXIT_LOCKED:
    case Terrain.BARRICADE:
    case Terrain.STATUE:
    case Terrain.BOOKSHELF:
    case Terrain.PEDESTAL:
    case Terrain.ALCHEMY:
    case Terrain.CHEST:
    case Terrain.CHEST_LOCKED:
    case Terrain.TOMB:
      return false;
    default:
      return true;
  }
}

/**
 * Vanilla `Level.losBlocking[c]` (Terrain.java LOS_BLOCKING: WALL, DOOR,
 * SECRET_DOOR, HIGH_GRASS, BARRICADE). The beam stops AT such a cell —
 * it is the impact cell (Ballistica.java:120-121).
 */
function beamLosBlocking(t: Terrain): boolean {
  switch (t) {
    case Terrain.WALL:
    case Terrain.DOOR:
    case Terrain.DOOR_SECRET:
    case Terrain.DOOR_LOCKED:
    case Terrain.HIGH_GRASS:
    case Terrain.BARRICADE:
      return true;
    default:
      return false;
  }
}

/** Solid cells for distance-map traversal (Avalanche). */
function solidAt(level: Level, pos: number): boolean {
  const t = level.tiles[pos] as Terrain;
  return !beamPassable(t) && t !== Terrain.DOOR && t !== Terrain.DOOR_SECRET;
}

function ballisticaWorldOf(ctx: ActionContext): BallisticaWorld {
  const level = ctx.level;
  const w = level.w;
  const hero = heroOf(ctx);
  return {
    w,
    h: level.h,
    beamPassableAt: (pos) => beamPassable(level.tiles[pos] as Terrain),
    losBlockingAt: (pos) => beamLosBlocking(level.tiles[pos] as Terrain),
    charAt: (pos) =>
      (hero.isAlive() && hero.pos === pos) ||
      ctx.mobs.some((m) => m.isAlive() && m.y * w + m.x === pos),
  };
}

/* ------------------------------------------------------------------ */
/* Effect helpers                                                       */
/* ------------------------------------------------------------------ */

type ZapChar = ContentHero | ContentMob;

function isZapCharAlive(ch: ZapChar): boolean {
  return ch.isAlive();
}

/**
 * Adapt a zap-target char for the trap layer (traps.ts is mechanics-owned
 * and reads `kind` to pick hero/mob branches). ContentHero already carries
 * kind='hero'; ContentMob gains the tag here (mobs.ts's Buffable declares
 * kind?: string, so the stamp is type-safe and inert elsewhere).
 */
function asTrapChar(ch: ZapChar): TrapChar {
  if (ch instanceof ContentHero) return ch;
  return Object.assign(ch, { kind: 'mob' as const });
}

/**
 * Damage any char with a wand (mirrors strikeMobVsHero's hero branch for
 * the hero; damageMobDirect for mobs). The engine's loop owns death
 * detection for the hero.
 */
function damageZapChar(
  ctx: ActionContext,
  target: ZapChar,
  amount: number,
  source: string,
): void {
  if (target instanceof ContentHero) {
    const applied = applyDamage(
      ctx.rng,
      {
        hp: target.hp,
        ht: target.ht,
        paralysed: target.paralysed,
        immunities: [],
        resistances: [],
      },
      amount,
      source,
    );
    target.hp = applied.hp;
    if (applied.paralysisBroken) target.paralysed = false;
  } else {
    damageMobDirect(ctx, target, amount, source);
  }
}

/** Buff.affect stacking (Buff.affect/prolong add duration when present). */
function prolongBuff(target: ZapChar, kind: BuffKind, duration: number): void {
  const cur = target.buffs[kind];
  target.buffs[kind] = { kind, left: (cur ? cur.left : 0) + duration };
}

/** Ring-of-Elements level for a char (mobs never wear rings). */
function elementsLevelOf(ch: ZapChar): number | null {
  if (ch instanceof ContentHero) {
    const b = ch.buffs['ring_elements'];
    return b ? (b.level ?? 0) : null;
  }
  return null;
}

/** Local respawn-cell roll (Level.randomRespawnCell, Level.java:386-391). */
function randomRespawnCell(ctx: ActionContext, hero: ContentHero): number {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0; i < 10; i++) {
    const cell = ctx.rng.int(0, n);
    const x = cell % level.w;
    const y = Math.floor(cell / level.w);
    if (!isRespawnPassable(level, x, y)) continue;
    if (level.visible[cell]) continue;
    if (hero.pos === cell) continue;
    if (charAtPos(ctx, cell)) continue;
    return cell;
  }
  return -1;
}

function isRespawnPassable(level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false;
  return beamPassable(level.tiles[y * level.w + x] as Terrain);
}

/** Dewdrop heal (actions.ts pickupDewdrop, Dewdrop.java:41-64). */
function healDewdrop(ctx: ActionContext, hero: ContentHero, qty: number): void {
  const value = 1 + Math.floor((ctx.level.depth - 1) / 5);
  const effect = Math.min(hero.ht - hero.hp, value * qty);
  if (effect > 0) {
    hero.hp += effect;
    ctx.log(`+${effect}HP`);
  }
}

/* ------------------------------------------------------------------ */
/* The 13 onZap effects                                                 */
/* ------------------------------------------------------------------ */

function effectMagicMissile(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const target = charAtPos(ctx, ball.cell);
  if (target) {
    damageZapChar(ctx, target, magicMissileDamage(ctx.rng, power), 'wand');
  }
  fx({ kind: 'missile', from: hero.pos, to: ball.cell });
}

function effectFirebolt(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const level = ctx.level;
  // WandOfFirebolt.onZap: ignite flamable trace cells (4), seed impact (1).
  for (let i = 1; i < ball.distance - 1; i++) {
    const c = ball.trace[i]!;
    if (isFlamableForBlob(level.tiles[c] as Terrain)) {
      seedBlob(level.blobs, 'fire', c, 4, level.w * level.h);
    }
  }
  seedBlob(level.blobs, 'fire', ball.cell, 1, level.w * level.h);
  const target = charAtPos(ctx, ball.cell);
  if (target) {
    damageZapChar(ctx, target, fireboltDamage(ctx.rng, power), 'wand');
    // Burning.reignite: a target already ablaze burns at full duration.
    if (isZapCharAlive(target) && target.buffs['burning']) {
      const full = BURNING_DURATION * elementsDurationFactor(elementsLevelOf(target));
      target.buffs['burning'] = { kind: 'burning', left: full };
    }
  }
  fx({ kind: 'missile', from: hero.pos, to: ball.cell });
}

function effectLightning(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  // WandOfLightning.fx: the damage happens in fx(), chaining through
  // 8-neighbours with Random.Int(damage/2, damage); stops below 1.
  const level = ctx.level;
  const w = level.w;
  const affected = new Set<ZapChar>();
  const points = [hero.pos];
  const hit = (ch: ZapChar, damage: number): void => {
    if (damage < 1) return;
    affected.add(ch);
    const inWater =
      (level.tiles[ch.pos] as Terrain) === Terrain.WATER && !ch.flying;
    damageZapChar(ctx, ch, inWater ? damage * 2 : damage, 'lightning');
    points.push(ch.pos);
    const ns: ZapChar[] = [];
    const cx = ch.pos % w;
    const cy = Math.floor(ch.pos / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= level.h) continue;
        const n = charAtPos(ctx, ny * w + nx);
        if (n && isZapCharAlive(n) && !affected.has(n)) ns.push(n);
      }
    }
    if (ns.length > 0) hit(ctx.rng.pick(ns), lightningChainDamage(ctx.rng, damage));
  };
  const first = charAtPos(ctx, ball.cell);
  if (first && isZapCharAlive(first)) {
    hit(first, lightningInitialDamage(ctx.rng, power));
  } else {
    points.push(ball.cell);
  }
  fx({ kind: 'strike', points });
  // WandOfLightning.onZap: killing yourself fails the run with a message.
  if (!hero.isAlive()) {
    ctx.log('You killed yourself with your own Wand of Lightning...');
  }
}

function effectDisintegration(
  ctx: ActionContext,
  _hero: ContentHero,
  power: number,
  rawLevel: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const level = ctx.level;
  // WandOfDisintegration: distance() = level() + 4 (RAW level, not power).
  const effDistance = Math.min(ball.distance, disintegrationMaxDistance(rawLevel));
  let terrainAffected = false;
  const chars: ZapChar[] = [];
  for (let i = 1; i < effDistance; i++) {
    const c = ball.trace[i]!;
    const ch = charAtPos(ctx, c);
    if (ch && isZapCharAlive(ch)) chars.push(ch);
    const t = level.tiles[c] as Terrain;
    if (t === Terrain.DOOR) {
      setLevelTile(level, c, Terrain.EMBERS); // Level.destroy
      terrainAffected = true;
    } else if (t === Terrain.HIGH_GRASS) {
      setLevelTile(level, c, Terrain.GRASS);
      terrainAffected = true;
    }
  }
  // Dungeon.observe() on terrain change: FOV refresh is engine-owned.
  void terrainAffected;
  // lvl = power() + chars.size(); NormalIntRange(lvl, 8 + lvl^2/3).
  for (const ch of chars) {
    damageZapChar(ctx, ch, disintegrationDamage(ctx.rng, power, chars.length), 'wand');
  }
  fx({ kind: 'beam', cells: ball.trace.slice(0, effDistance) });
}

function setLevelTile(level: Level, pos: number, t: Terrain): void {
  level.tiles[pos] = t;
  // GameScene.updateMap / Dungeon.observe: renderer + FOV refresh,
  // engine-owned.
}

function effectAvalanche(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const level = ctx.level;
  const size = avalancheSize(power);
  // PathFinder.buildDistanceMap(cell, not(solid), size) — 4-neighbourhood.
  const dist = buildDistanceMap(
    level.w,
    level.h,
    ball.cell,
    (pos) => !solidAt(level, pos),
    size,
  );
  const n = level.w * level.h;
  const burst: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dist[i];
    if (d === Infinity) continue;
    burst.push(i);
    const ch = charAtPos(ctx, i);
    if (ch && isZapCharAlive(ch)) {
      damageZapChar(ctx, ch, avalancheDamage(ctx.rng, size, d), 'wand');
      // Buff.prolong(ch, Paralysis.class, IntRange(2,6)) — NOT elements-scaled.
      if (isZapCharAlive(ch) && avalancheParalyzes(ctx.rng, d)) {
        prolongBuff(ch, 'paralysis', avalancheParalysisDuration(ctx.rng));
      }
    }
    // Dungeon.level.press(i, ch): mobPress for mobs still alive after the
    // blast, press(i, null) when the char died or the cell is empty
    // (Avalanche.java:80-88).
    pressTrapCell(
      ctx,
      i,
      ch && isZapCharAlive(ch) ? asTrapChar(ch) : null,
      (mobId, pos) => {
        const mob = buildMob(mobId, nextMobId(), pos, level.w);
        mob.state = 'wandering';
        ctx.addMob(mob, 2);
      },
    );
  }
  fx({ kind: 'burst', cells: burst });
}

function effectPoison(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const target = charAtPos(ctx, ball.cell);
  if (target && isZapCharAlive(target)) {
    // Poison.set (SET, not add): durationFactor * (5 + power()).
    const dur =
      poisonWandDuration(power) * elementsDurationFactor(elementsLevelOf(target));
    target.buffs['poison'] = { kind: 'poison', left: dur };
  } else {
    ctx.log(TXT_NOTHING_HAPPENED);
  }
  void hero;
}

function effectAmok(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const target = charAtPos(ctx, ball.cell);
  if (target && isZapCharAlive(target)) {
    if (target instanceof ContentHero) {
      // Zapping yourself drives you mad: Vertigo, elements-scaled.
      prolongBuff(target, 'vertigo', vertigoDuration(elementsLevelOf(target)));
    } else {
      prolongBuff(target, 'amok', amokWandDuration(power)); // 3 + power()
    }
  } else {
    ctx.log(TXT_NOTHING_HAPPENED);
  }
  void hero;
}

function effectSlowness(
  ctx: ActionContext,
  _hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const target = charAtPos(ctx, ball.cell);
  if (target && isZapCharAlive(target)) {
    // Slow.duration(ch)/3 + power() — Slow.duration is elements-scaled.
    prolongBuff(target, 'slow', slowDuration(elementsLevelOf(target)) / 3 + power);
  } else {
    ctx.log(TXT_NOTHING_HAPPENED);
  }
}

function effectBlink(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const dest = blinkDestinationCell(
    ball.trace,
    ball.distance,
    power,
    charAtPos(ctx, ball.cell) != null,
  );
  const from = hero.pos;
  hero.pos = dest;
  // ScrollOfTeleportation.appear: press + observe are engine-owned.
  fx({ kind: 'missile', from, to: dest });
}

function effectTeleportation(
  ctx: ActionContext,
  hero: ContentHero,
  _power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const target = charAtPos(ctx, ball.cell);
  if (target && isZapCharAlive(target)) {
    if (target instanceof ContentHero) {
      // setKnown() then teleport self (ScrollOfTeleportation.teleportHero).
      identifyWandType('teleportation', ctx.log);
      const cell = randomRespawnCell(ctx, hero);
      if (cell !== -1) {
        hero.pos = cell;
      } else {
        ctx.log('There is nowhere to teleport to!');
      }
    } else {
      let pos = -1;
      for (let count = 10; count > 0; count--) {
        pos = randomRespawnCell(ctx, hero);
        if (pos !== -1) break;
      }
      if (pos === -1) {
        ctx.log('There is nowhere to teleport to!');
      } else {
        target.pos = pos;
        ctx.log(`${hero.name} teleported ${target.name} to somewhere`);
      }
    }
  } else {
    ctx.log(TXT_NOTHING_HAPPENED);
  }
}

function effectFlock(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const level = ctx.level;
  const n = flockSheepCount(power); // power() + 2
  let cell = ball.cell;
  // Occupied endpoint with a beam longer than 2: shift one cell back.
  if (charAtPos(ctx, cell) != null && ball.distance > 2) {
    cell = ball.trace[ball.distance - 2]!;
  }
  const occupied = new Set<number>();
  if (hero.isAlive()) occupied.add(hero.pos);
  for (const m of ctx.mobs) if (m.isAlive()) occupied.add(m.y * level.w + m.x);
  const positions = flockSheepPositions(
    level.w,
    level.h,
    cell,
    (pos) => beamPassable(level.tiles[pos] as Terrain),
    (pos) => occupied.has(pos),
    n,
  );
  const lifespan = flockLifespan(power);
  for (const pos of positions) {
    spawnFlockSheep(ctx, pos, lifespan);
  }
  fx({ kind: 'sheep', cells: positions });
}

function effectRegrowth(
  ctx: ActionContext,
  _hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const level = ctx.level;
  // Immediate trace conversion (WandOfRegrowth.onZap): bare/burned ground
  // becomes grass along the beam.
  for (let i = 1; i < ball.distance - 1; i++) {
    const c = ball.trace[i]!;
    const t = level.tiles[c] as Terrain;
    if (t === Terrain.FLOOR || t === Terrain.EMBERS) {
      setLevelTile(level, c, Terrain.GRASS);
    }
  }
  const cell = ball.cell;
  const t = level.tiles[cell] as Terrain;
  if (
    t === Terrain.FLOOR ||
    t === Terrain.EMBERS ||
    t === Terrain.GRASS ||
    t === Terrain.HIGH_GRASS
  ) {
    seedRegrowthBlob(level.blobs, cell, regrowthSeedAmount(power), level.w * level.h);
  } else {
    ctx.log(TXT_NOTHING_HAPPENED);
  }
}

/**
 * Vanilla Regrowth blob (actors/blobs/Regrowth.java). Unlike gas blobs it
 * does NOT diffuse: super.evolve() only ticks each cell down by 1 per
 * round. Cells with volume convert terrain — bare/burned ground becomes
 * grass (high grass when volume > 1), grass becomes high grass when
 * volume > 1. Port terrain mapping: vanilla EMPTY/EMPTY_DECO -> FLOOR
 * (the port has no deco variant).
 *
 * Owned here (not in mechanics/blobs.ts) because that file is another
 * worker's; the engine ticks every Blob in level.blobs polymorphically,
 * so this subclass evolves through the normal blob pipeline.
 */
export class RegrowthBlob extends Blob {
  constructor(length: number) {
    super('regrowth' as BlobKind, length);
  }

  override evolve(_rng: MechanicsRng, world: BlobWorld): void {
    const { length } = world;
    const { cur, off } = this;
    for (let pos = 0; pos < length; pos++) {
      if (cur[pos] > 0) {
        // super.evolve(): off[pos] = cur[pos] - 1 (Regrowth.java:60).
        // The growth check reads the PRE-decrement volume (cur[i] > 1),
        // because the off/cur swap happens after evolve() in Blob.act().
        const grown = cur[pos] > 1;
        const v = cur[pos] - 1;
        this.volume += off[pos] = v;
        const t = world.tileAt(pos);
        let c1 = t;
        if (t === Terrain.FLOOR || t === Terrain.EMBERS) {
          c1 = grown ? Terrain.HIGH_GRASS : Terrain.GRASS;
        } else if (t === Terrain.GRASS && grown) {
          c1 = Terrain.HIGH_GRASS;
        }
        if (c1 !== t) {
          world.setTile(pos, c1);
          // GameScene.updateMap / discoverTile / Dungeon.observe():
          // renderer + FOV refresh — the engine owns them.
        }
      } else {
        off[pos] = 0;
      }
    }
  }
}

/**
 * Seed the Regrowth blob at a cell (Blob.seed(cell, amount) semantics:
 * cur[cell] += amount). Creates the blob on first use.
 */
export function seedRegrowthBlob(
  blobs: Blob[],
  cell: number,
  amount: number,
  length: number,
): RegrowthBlob {
  let blob = blobs.find((b) => b instanceof RegrowthBlob) as
    | RegrowthBlob
    | undefined;
  if (!blob) {
    blob = new RegrowthBlob(length);
    blobs.push(blob);
  }
  blob.seed(cell, amount);
  return blob;
}

function effectReach(
  ctx: ActionContext,
  hero: ContentHero,
  power: number,
  ball: BallisticaResult,
  _fx: WandFx,
): void {
  const level = ctx.level;
  const reach = reachDistance(ball.distance, power);
  for (let i = 1; i < reach; i++) {
    const c = ball.trace[i]!;
    const before = level.tiles[c] as Terrain;
    const ch = charAtPos(ctx, c);
    if (ch && isZapCharAlive(ch) && !(ch instanceof ContentHero)) {
      // Actor.addDelayed(new Swap(curUser, ch)): exchange positions.
      const heroPos = hero.pos;
      hero.pos = ch.pos;
      ch.pos = heroPos;
      break;
    }
    const heapIdx = level.items.findIndex((it) => it.pos === c);
    if (heapIdx !== -1) {
      const heap = level.items[heapIdx]!;
      if (heap.lockedChest) break; // locked heaps are not in the switch
      level.items.splice(heapIdx, 1);
      const { defId, qty } = parseItemId(heap.itemId);
      if (defId === 'dewdrop') {
        healDewdrop(ctx, hero, qty);
      } else {
        const pickupId =
          parseWandId(heap.itemId) != null
            ? normalizeWandPickup(ctx.rng, heap.itemId)
            : parseRingId(heap.itemId) != null
              ? normalizeRingPickup(ctx.rng, heap.itemId)
              : heap.itemId;
        addToInventory(hero, pickupId, qty);
        ctx.log(txtReachTransported(getItem(pickupId).name));
      }
      break;
    }
    pressTrapCell(ctx, c, null, (mobId, pos) => {
      const mob = buildMob(mobId, nextMobId(), pos, level.w);
      mob.state = 'wandering';
      ctx.addMob(mob, 2);
    });
    if (before === Terrain.OPEN_DOOR) {
      setLevelTile(level, c, Terrain.DOOR);
    }
    // GameScene.ripple(c) on water: purely visual, renderer-owned.
  }
  // Dungeon.observe() when a door closed: FOV refresh is engine-owned.
}

/** Dispatch to the wand's onZap effect. */
function applyZapEffect(
  ctx: ActionContext,
  hero: ContentHero,
  state: WandState,
  ball: BallisticaResult,
  fx: WandFx,
): void {
  const power = wandZapPower(hero, state, true);
  switch (state.wandId) {
    case 'magic_missile':
      return effectMagicMissile(ctx, hero, power, ball, fx);
    case 'firebolt':
      return effectFirebolt(ctx, hero, power, ball, fx);
    case 'lightning':
      return effectLightning(ctx, hero, power, ball, fx);
    case 'disintegration':
      return effectDisintegration(ctx, hero, power, state.level, ball, fx);
    case 'avalanche':
      return effectAvalanche(ctx, hero, power, ball, fx);
    case 'poison':
      return effectPoison(ctx, hero, power, ball, fx);
    case 'amok':
      return effectAmok(ctx, hero, power, ball, fx);
    case 'slowness':
      return effectSlowness(ctx, hero, power, ball, fx);
    case 'blink':
      return effectBlink(ctx, hero, power, ball, fx);
    case 'teleportation':
      return effectTeleportation(ctx, hero, power, ball, fx);
    case 'flock':
      return effectFlock(ctx, hero, power, ball, fx);
    case 'regrowth':
      return effectRegrowth(ctx, hero, power, ball, fx);
    case 'reach':
      return effectReach(ctx, hero, power, ball, fx);
  }
}

/* ------------------------------------------------------------------ */
/* Flock sheep                                                          */
/* ------------------------------------------------------------------ */

/**
 * Vanilla Sheep (mobs/npcs/Sheep.java): an invulnerable NPC that wanders
 * and is destroyed when its lifespan runs out. The port's mob registry
 * does not have a sheep def yet (mob_sheep sprite pending extraction),
 * so the def is built locally; the mob worker owns actMob behavior.
 */
const SHEEP_DEF: MobDef = {
  id: 'sheep',
  name: 'sheep',
  sprite: 'mob_sheep',
  hp: 10,
  atk: 0,
  def: 0,
  dmgMin: 0,
  dmgMax: 0,
  triangular: true,
  dr: 0,
  exp: 0,
  maxLvl: 1,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [],
  resistances: [],
};

/** Remaining lifespan per sheep mob id (Sheep.lifespan, Sheep.java). */
const sheepLifespans = new Map<number, number>();

/**
 * Spawn one flock sheep (WandOfFlock.onZap: `sheep.lifespan = lifespan`,
 * `GameScene.add(sheep)`, `Dungeon.level.mobPress(sheep)`).
 */
export function spawnFlockSheep(
  ctx: ActionContext,
  pos: number,
  lifespan: number,
): void {
  const level = ctx.level;
  const sheep = new ContentMob(nextMobId(), SHEEP_DEF, pos, level.w);
  sheep.invulnerable = true; // NPC.damage() is a no-op (NPC.java:33-37)
  sheep.hostile = false;
  sheep.state = 'wandering';
  sheepLifespans.set(sheep.id, lifespan);
  ctx.addMob(sheep);
  pressTrapCell(ctx, pos, asTrapChar(sheep), (mobId, p) => {
    const mob = buildMob(mobId, nextMobId(), p, level.w);
    mob.state = 'wandering';
    ctx.addMob(mob, 2);
  });
}

/**
 * Tick flock sheep lifespans (Sheep.act: `if (--lifespan <= 0) die(null)`).
 * COORDINATOR SEAM: call once per round (or fold into the mob worker's
 * actMob 'sheep' case). Expired sheep are removed silently.
 */
export function tickFlockSheep(ctx: ActionContext): void {
  for (const [id, left] of sheepLifespans) {
    const next = left - 1;
    if (next <= 0) {
      sheepLifespans.delete(id);
      const mob = ctx.mobs.find((m) => m.id === id);
      if (mob) ctx.removeMob(mob);
    } else {
      sheepLifespans.set(id, next);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Use action + recharge seams                                          */
/* ------------------------------------------------------------------ */

/**
 * The inventory "use" action for a wand (Wand.execute, AC_ZAP):
 * prompts for a target. Returns 'target' so the UI can enter
 * cell-targeting mode, or a turn cost when the zap resolved/fizzled.
 *
 * COORDINATOR SEAM: useInventorySlot's wand branch + the zapWand intent
 * in handleHeroIntent should call zapWandFromSlot.
 */
export function useWandFromSlot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): 'target' | number {
  const stack = hero.inventory[slot];
  if (!stack || !isWandId(stack.itemId)) return 1;
  const st = getWandState(stack.itemId);
  if (!st) return 1;
  // Wand.execute: beginZap identifies the TYPE even on fizzle.
  const { fizzled } = beginZap(ctx, hero, st);
  if (fizzled) return 1;
  return 'target';
}

/**
 * Resolve the zap once the player picks a target cell
 * (Wand.zapper.onSelect). Returns the turn cost (1).
 */
export function zapWandFromSlot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  targetCell: number,
  fx: WandFx = WandFxNoop,
): number {
  const stack = hero.inventory[slot];
  if (!stack) return 1;
  const st = getWandState(stack.itemId);
  if (!st) return 1;
  const res = resolveZap(ctx, hero, st, targetCell, fx);
  return res.ok ? res.spent : 1;
}

/**
 * Recharge every wand in the hero's inventory (Wand.Charger.act on each
 * wand; the port runs one accumulator per wand instead of Buff actors).
 * COORDINATOR SEAM: call from tickHeroClock with the turn cost.
 */
export function rechargeWands(
  hero: ContentHero,
  timeUnits: number,
  mageClass: boolean,
): void {
  for (const stack of hero.inventory) {
    const st = getWandState(stack.itemId);
    if (st) rechargeWand(hero, st, timeUnits, mageClass);
  }
}

/**
 * Drop a wand instance on the floor (vanilla heap with the wand item).
 * The placed item keeps the full instance id so its state survives.
 */
export function dropWandAt(
  ctx: ActionContext,
  instanceId: string,
  pos: number,
): void {
  const parsed = parseWandId(instanceId);
  ctx.level.items.push({
    itemId: instanceId,
    pos,
    sprite: parsed ? wandDisplaySprite(parsed.wandId) : 'wand_magic_missile',
  });
}

/**
 * True when the id is served by the item catalog (static ITEMS or the
 * wand/ring instance fallback). The DM-300 worker's loot gate
 * (`ITEMS['ring_of_thorns']`, src/content/dm300-boss.ts) should use this
 * instead of the static ITEMS map, which cannot hold instance defs.
 */
export function catalogHas(id: string): boolean {
  if (isWandId(id) || isRingId(id)) return true;
  try {
    getItem(id);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Module load: identification registration                            */
/* ------------------------------------------------------------------ */

registerWandIdClasses();

/**
 * Per-instance def lookup for the coordinator's UI layer. Static ITEMS
 * cannot hold instance defs (level/charges/identification are per
 * instance), so the coordinator wires this into its item-def lookup:
 * `instanceItemDef(id) ?? getItem(id)`.
 */
export function instanceItemDef(defId: string): ItemDef | null {
  if (defId.startsWith('wand_of_')) return wandItemDef(defId);
  return ringItemDefFor(defId);
}

/* ------------------------------------------------------------------ */
/* Save / load                                                          */
/* ------------------------------------------------------------------ */

/** JSON-serializable wand state (Wand.storeInBundle, Wand.java:390-404). */
export interface WandSaveData {
  seq: number;
  states: WandState[];
}

/** Snapshot wand instances for the save bundle. */
export function saveWandState(): WandSaveData {
  return { seq: wandSeq, states: [...wandStates.values()] };
}

/**
 * Restore wand instances from the save bundle.
 * COORDINATOR SEAM: call from the run's save/load alongside
 * saveQuestState/restoreQuestState (the Wandmaker reward instance ids
 * reference these states).
 */
export function restoreWandState(data: WandSaveData | undefined): void {
  wandStates.clear();
  if (!data) {
    wandSeq = 0;
    return;
  }
  wandSeq = data.seq;
  for (const st of data.states) wandStates.set(st.instanceId, { ...st });
}
