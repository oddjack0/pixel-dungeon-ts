/**
 * Potions (GPL-3.0; ground truth: watabou/pixel-dungeon,
 * `items/potions/Potion.java` + the 12 `items/potions/PotionOf*.java`).
 *
 * The brief asked for "all 13 potions" but the Java source contains 12
 * potion classes (Potion.java:40-41 lists 12 in `handler`); this module
 * implements all 12 — Java wins.
 *
 * Class order (Potion.java:40-41) and weights (itemgen.ts, vanilla
 * Generator.java potion order):
 *   Healing(45) Experience(4) ToxicGas(15) LiquidFlame(15) Strength(0)
 *   ParalyticGas(10) Levitation(10) MindVision(20) Purity(12)
 *   Invisibility(10) Might(0) Frost(10)
 *
 * Key behavior (Potion.java):
 * - Labels/colors: turquoise crimson azure jade golden magenta charcoal
 *   ivory amber bistre indigo silver (Potion.java:43-56); unknown name is
 *   "<color> potion" (Potion.java:82-84); base price 20 (Potion.java:228).
 * - Drinking takes TIME_TO_DRINK = 1 (Potion.java:53) and routes through
 *   onThrow(hero.pos) -> apply(hero) (Potion.java:184-193).
 * - Throwing at the hero applies the potion; throwing at a well or
 *   pit/chasm drops it intact; otherwise it shatters (Potion.java:195-207).
 * - Harmful-drink confirm (known LiquidFlame/ToxicGas/ParalyticGas):
 *   "Harmful potion!" / "Are you sure you want to drink it?" (Potion.java
 *   :125-146). Beneficial-throw confirm (known Experience/Healing/
 *   Levitation/MindVision/Strength/Invisibility/Might): "Beneficial
 *   potion" / "Are you sure you want to shatter it?" (Potion.java:155-176).
 *   The port has no modal UI in the action layer, so a confirm is
 *   recorded as pending state (pendingPotionConfirm) and resolved via
 *   resolvePotionConfirm — the UI presents the exact vanilla strings.
 * - Default shatter() away from the hero is a harmless splash
 *   (Potion.java:211-219): most potions have NO area effect. Only
 *   ToxicGas/ParalyticGas/LiquidFlame/Frost/Purity override shatter().
 *
 * `PotionOfHealing`/`PotionOfStrength` defs live in items.ts (Stage 1);
 * this module owns the 10 new defs plus the run-wide behavior for all 12.
 */
import type { ActionContext } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import { Terrain } from '../core/grid.js';
/**
 * Buff.affect semantics (Buff.java:79-83): attach if absent, then EXTEND the
 * remaining time by duration. House pattern is a direct buffs-record write
 * (cf. mobs.ts:1245, traps.ts:259).
 */
export function affectBuff(
  buffs: Partial<Record<BuffKind, BuffState>>,
  kind: BuffKind,
  duration: number,
): void {
  const cur = buffs[kind];
  buffs[kind] = cur ? { ...cur, left: cur.left + duration } : { kind, left: duration };
}

/**
 * Buff.prolong semantics (Buff.java:85-89): attach if absent, else remaining
 * = max(remaining, duration).
 */
export function prolongBuff(
  buffs: Partial<Record<BuffKind, BuffState>>,
  kind: BuffKind,
  duration: number,
  extra?: { sourceId?: number },
): void {
  const cur = buffs[kind];
  const next = cur
    ? { ...cur, left: Math.max(cur.left, duration) }
    : { kind, left: duration };
  if (extra?.sourceId !== undefined) next.sourceId = extra.sourceId;
  buffs[kind] = next;
}
import type { BuffKind } from '../mechanics/buffs.js';
import type { BuffState } from '../mechanics/char.js';
import { seedBlob } from '../mechanics/blobs.js';
import { earnExp, maxExp } from '../mechanics/exp.js';
import {
  knowPotion,
  potionImage,
  potionLabel,
  isPotionKnown,
  identificationReady,
  POTION_COLORS,
  POTION_IMAGES,
  type FamilyDef,
} from './identification.js';
import {
  addToInventory,
  removeFromInventory,
  type ContentHero,
  type ItemStack,
} from './hero.js';
import type { ItemDef } from './items.js';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Catalog ids in vanilla class order (Potion.java:40-41). */
export const POTION_CLASS_ORDER: readonly string[] = [
  'potion_healing',
  'potion_experience',
  'potion_toxicgas',
  'potion_liquidflame',
  'potion_strength',
  'potion_paralyticgas',
  'potion_levitation',
  'potion_mindvision',
  'potion_purity',
  'potion_invisibility',
  'potion_might',
  'potion_frost',
];

const POTION_ID_SET = new Set<string>(POTION_CLASS_ORDER);

/** True for the 12 vanilla potion catalog ids (incl. Stage-1 healing/strength). */
export function isPotionId(id: string): boolean {
  return POTION_ID_SET.has(id);
}

function def(
  id: string,
  name: string,
  sprite: string,
  desc: string,
): ItemDef {
  return {
    id,
    name,
    sprite,
    type: 'potion',
    stackable: true,
    desc,
    /** Potion.price() = 20 unidentified (Potion.java:228); known prices vary. */
    price: 20,
  };
}

/**
 * The 10 new potion defs. Names/descs are verbatim from the Java classes;
 * sprite keys are the extracted ItemSpriteSheet frames (Worker 6).
 */
export const POTION_DEFS: Record<string, ItemDef> = {
  potion_experience: def(
    'potion_experience',
    'Potion of Experience',
    'item_potion_experience',
    // PotionOfExperience.java desc()
    'The storied experiences of multitudes of battles reduced to vapours, ' +
      'this draught will instantly raise your experience level.',
  ),
  potion_toxicgas: def(
    'potion_toxicgas',
    'Potion of Toxic Gas',
    'item_potion_toxicgas',
    // PotionOfToxicGas.java desc()
    'Uncorking or shattering this pressurized glass will cause its contents ' +
      'to explode into a deadly cloud of toxic green gas. You might choose ' +
      'to fling this potion at distant enemies instead of uncorking it by hand.',
  ),
  potion_liquidflame: def(
    'potion_liquidflame',
    'Potion of Liquid Flame',
    'item_potion_liquidflame',
    // PotionOfLiquidFlame.java desc()
    'This flask contains an unstable compound which will burst violently ' +
      'into flame upon exposure to open air.',
  ),
  potion_paralyticgas: def(
    'potion_paralyticgas',
    'Potion of Paralytic Gas',
    'item_potion_paralyticgas',
    // PotionOfParalyticGas.java desc()
    'Uncorking or shattering this pressurized glass will cause its contents ' +
      'to explode into a cloud of paralyzing gas. You might choose to fling ' +
      'this potion at distant enemies instead of uncorking it by hand.',
  ),
  potion_levitation: def(
    'potion_levitation',
    'Potion of Levitation',
    'item_potion_levitation',
    // PotionOfLevitation.java desc()
    'This curious solution will fill you with buoyancy. If you drink it, ' +
      'you will begin to float.',
  ),
  potion_mindvision: def(
    'potion_mindvision',
    'Potion of Mind Vision',
    'item_potion_mindvision',
    // PotionOfMindVision.java desc()
    'After drinking this, your mind will become attuned to the psychic ' +
      'signature of distant creatures, enabling you to sense biological ' +
      'presences through walls. Also this potion will permit you to see ' +
      'through nearby walls and darkness.',
  ),
  potion_purity: def(
    'potion_purity',
    'Potion of Purification',
    'item_potion_purity',
    // PotionOfPurity.java desc()
    'This cloudy fluid will disperse any noxious clouds of gas which may be ' +
      'plaguing your vicinity. When you drink it, any gas effects afflicting ' +
      'you will be neutralized.',
  ),
  potion_invisibility: def(
    'potion_invisibility',
    'Potion of Invisibility',
    'item_potion_invisibility',
    // PotionOfInvisibility.java desc()
    'Drinking this potion will render you temporarily invisible. Enemies ' +
      'will be unable to see you, although any action you take (such as ' +
      'attacking) will dispel the effect.',
  ),
  potion_might: def(
    'potion_might',
    'Potion of Might',
    'item_potion_might',
    // PotionOfMight.java desc()
    'This powerful liquid will course through your muscles, permanently ' +
      'increasing your strength by one point and health by five points.',
  ),
  potion_frost: def(
    'potion_frost',
    'Potion of Frost',
    'item_potion_frost',
    // PotionOfFrost.java desc()
    'Upon exposure to open air, the fluid will evaporate, releasing an icy ' +
      'blast.',
  ),
};

/** Known prices (per Java price() overrides; base 20 unidentified). */
export const POTION_KNOWN_PRICES: Readonly<Record<string, number>> = {
  potion_healing: 30, // PotionOfHealing.java
  potion_experience: 80, // PotionOfExperience.java
  potion_toxicgas: 40,
  potion_liquidflame: 40,
  potion_strength: 100, // PotionOfStrength.java
  potion_paralyticgas: 40,
  potion_levitation: 35, // PotionOfLevitation.java
  potion_mindvision: 35, // PotionOfMindVision.java
  potion_purity: 50, // PotionOfPurity.java
  potion_invisibility: 40, // PotionOfInvisibility.java
  potion_might: 200, // PotionOfMight.java
  potion_frost: 50, // PotionOfFrost.java
};

/**
 * Family def for initIdentification. Image pool: the 12 vanilla images in
 * class order. NOTE: Worker 6 has not yet extracted the healing/strength
 * frames (item_potion_turquoise / item_potion_jade); until then the pool
 * falls back to the Stage-1 custom sprites for those two classes. Labels
 * (colors) are exact for all 12.
 */
export function potionFamilyDef(): FamilyDef {
  return {
    classes: [...POTION_CLASS_ORDER],
    labels: [...POTION_COLORS],
    images: POTION_IMAGES.map((img, i) =>
      img === 'item_potion_turquoise'
        ? 'potion_red' // TODO(worker6): extract ItemSpriteSheet.POTION_TURQUOISE
        : img === 'item_potion_jade'
          ? 'potion_strength' // TODO(worker6): extract ItemSpriteSheet.POTION_JADE
          : img,
    ),
  };
}

/** Display name: known -> "Potion of X"; unknown -> "<color> potion". */
export function potionDisplayName(id: string, knownName: string): string {
  if (identificationReady() && isPotionKnown(id)) return knownName;
  if (!identificationReady()) return knownName;
  return `${potionLabel(id)} potion`; // Potion.java:82-84
}

/** Run-assigned sprite once identified-system is up; catalog fallback before. */
export function potionSprite(id: string, fallback: string): string {
  return identificationReady() ? potionImage(id) : fallback;
}

/** price() = isKnown ? knownPrice * qty : 20 * qty (Potion.java:228). */
export function potionPrice(id: string, qty = 1): number {
  const unit =
    identificationReady() && isPotionKnown(id)
      ? (POTION_KNOWN_PRICES[id] ?? 20)
      : 20;
  return unit * qty;
}

/**
 * UI adapter info for the inventory panel (hooks.ts): dynamic name/sprite
 * once the ID system is initialized. Returns null for non-potions.
 */
export function potionUiInfo(
  id: string,
  knownName: string,
  catalogSprite: string,
): { name: string; sprite: string; identified: boolean } | null {
  if (!isPotionId(id)) return null;
  const known = identificationReady() && isPotionKnown(id);
  return {
    name: known ? knownName : `${potionLabel(id)} potion`,
    sprite: identificationReady() ? potionImage(id) : catalogSprite,
    identified: known,
  };
}

// ---------------------------------------------------------------------------
// Drink / throw confirmations (Potion.java:125-176)
// ---------------------------------------------------------------------------

/** Known harmful potions ask before drinking (Potion.java:127-132). */
const HARMFUL_DRINK_IDS = new Set([
  'potion_liquidflame',
  'potion_toxicgas',
  'potion_paralyticgas',
]);

/** Known beneficial potions ask before being thrown (Potion.java:157-164). */
const BENEFICIAL_THROW_IDS = new Set([
  'potion_experience',
  'potion_healing',
  'potion_levitation',
  'potion_mindvision',
  'potion_strength',
  'potion_invisibility',
  'potion_might',
]);

export interface PotionConfirm {
  slot: number;
  itemId: string;
  mode: 'drink' | 'throw';
  /** Throw target cell (drink ignores it). */
  cell: number;
  /** Exact vanilla dialog title + question. */
  title: string;
  question: string;
}

let pendingConfirm: PotionConfirm | null = null;

/** The confirm the UI should present, if any. */
export function pendingPotionConfirm(): PotionConfirm | null {
  return pendingConfirm;
}

function clearPotionConfirm(): void {
  pendingConfirm = null;
}

/**
 * Resolve a pending confirm. `accept` = the player tapped YES.
 * YES replays the original action (Potion.java:135-140 / 165-170);
 * NO cancels with no time spent.
 */
export function resolvePotionConfirm(
  ctx: ActionContext,
  hero: ContentHero,
  accept: boolean,
): number {
  const pc = pendingConfirm;
  clearPotionConfirm();
  if (!pc) return 0;
  if (!accept) return 0;
  if (pc.mode === 'drink') return drinkPotionConfirmed(ctx, hero, pc.slot);
  return throwPotionConfirmed(ctx, hero, pc.slot, pc.cell);
}

// ---------------------------------------------------------------------------
// Drinking (Potion.execute/drink, Potion.java:121-193)
// ---------------------------------------------------------------------------

/** TIME_TO_DRINK = 1 (Potion.java:53). */
export const TIME_TO_DRINK = 1;

function isKnownSafe(id: string): boolean {
  return identificationReady() && isPotionKnown(id);
}

/**
 * Drink the potion in `slot`. Returns the turn cost.
 * Known harmful potions (LiquidFlame/ToxicGas/ParalyticGas) record a
 * pending confirm and cost 0 turns until resolved.
 */
export function drinkPotion(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  if (isKnownSafe(stack.itemId) && HARMFUL_DRINK_IDS.has(stack.itemId)) {
    pendingConfirm = {
      slot,
      itemId: stack.itemId,
      mode: 'drink',
      cell: -1,
      title: 'Harmful potion!', // TXT_HARMFUL (Potion.java:44)
      question: 'Are you sure you want to drink it?', // TXT_R_U_SURE_DRINK
    };
    ctx.log('Harmful potion! Are you sure you want to drink it?');
    return 0;
  }
  return drinkPotionConfirmed(ctx, hero, slot);
}

/** drink(hero): detach, spend TIME_TO_DRINK, onThrow(hero.pos) (Potion.java:184-193). */
function drinkPotionConfirmed(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) return 1;
  const id = stack.itemId;
  removeFromInventory(hero, slot, 1);
  applyDrinkEffect(ctx, hero, id);
  return TIME_TO_DRINK;
}

/**
 * Potion.apply / shatter routing for drinking. Default Potion.apply(hero)
 * = shatter(hero.pos) (Potion.java:209-211); subclasses override.
 */
function applyDrinkEffect(
  ctx: ActionContext,
  hero: ContentHero,
  id: string,
): void {
  switch (id) {
    case 'potion_healing': {
      // PotionOfHealing.java:36-45: full heal + detach Poison/Cripple/
      // Weakness/Bleeding; setKnown() on drink.
      hero.hp = hero.ht;
      delete hero.buffs.poison;
      delete hero.buffs.cripple;
      delete hero.buffs.bleeding;
      hero.weakened = false;
      ctx.log('Your wounds heal completely.'); // TXT_VALUE
      break;
    }
    case 'potion_strength': {
      // PotionOfStrength.java:36-45
      hero.str += 1;
      ctx.log('Newfound strength surges through your body.'); // TXT_VALUE
      break;
    }
    case 'potion_experience': {
      // PotionOfExperience.java:34-41: earnExp(hero.maxExp() - hero.exp)
      const need = maxExp(hero.lvl) - hero.exp;
      earnExp(hero, need);
      ctx.log('You feel more experienced.'); // TXT_VALUE
      break;
    }
    case 'potion_might': {
      // PotionOfMight.java:35-44
      hero.str += 1;
      hero.ht += 5;
      hero.hp += 5;
      ctx.log('You feel stronger.'); // TXT_VALUE
      break;
    }
    case 'potion_mindvision': {
      // PotionOfMindVision.java:34-40 (no drink log in vanilla)
      affectBuff(hero.buffs, 'mindvision', 20); // MindVision.DURATION
      break;
    }
    case 'potion_levitation': {
      // PotionOfLevitation.java:34-42
      affectBuff(hero.buffs, 'levitation', 20); // Levitation.DURATION
      hero.flying = true;
      delete hero.buffs.roots;
      ctx.log('You float into the air!'); // TXT_VALUE
      break;
    }
    case 'potion_invisibility': {
      // PotionOfInvisibility.java:34-41
      affectBuff(hero.buffs, 'invisibility', 15); // Invisibility.DURATION
      ctx.log('You vanish!'); // TXT_VALUE
      break;
    }
    case 'potion_purity': {
      // PotionOfPurity.java:34-41: drink grants GasesImmunity(5)
      affectBuff(hero.buffs, 'gasesimmunity', 5); // GasesImmunity.DURATION
      ctx.log('You feel cleansed of impurities.'); // TXT_FRESHNESS
      break;
    }
    default: {
      // ToxicGas/ParalyticGas/LiquidFlame/Frost: no apply() override, so
      // drinking = shatter(hero.pos) (Potion.java:184-193, 209-211).
      shatterPotionAt(ctx, hero, hero.pos, id);
      break;
    }
  }
  // Every potion identifies when drunk: each PotionOf*.apply() calls
  // setKnown() (verified in all 12 PotionOf*.java).
  knowPotion(id);
}

// ---------------------------------------------------------------------------
// Throwing (Potion.doThrow/onThrow/shatter, Potion.java:155-219)
// ---------------------------------------------------------------------------

/** TIME_TO_THROW = 1 (Item.java:68). */
export const TIME_TO_THROW = 1;

/**
 * Throw the potion in `slot` at `cell` (already resolved by the throw
 * arc). Known beneficial potions record a pending confirm first.
 */
export function throwPotion(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  cell: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  if (isKnownSafe(stack.itemId) && BENEFICIAL_THROW_IDS.has(stack.itemId)) {
    pendingConfirm = {
      slot,
      itemId: stack.itemId,
      mode: 'throw',
      cell,
      title: 'Beneficial potion', // TXT_BENEFICIAL (Potion.java:45)
      question: 'Are you sure you want to shatter it?', // TXT_R_U_SURE_THROW
    };
    ctx.log('Beneficial potion. Are you sure you want to shatter it?');
    return 0;
  }
  return throwPotionConfirmed(ctx, hero, slot, cell);
}

/** detach -> onThrow(cell) (Item.java:574-578): hero cell applies, well/pit drops, else shatters. */
function throwPotionConfirmed(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  cell: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) return 1;
  const id = stack.itemId;
  removeFromInventory(hero, slot, 1);
  const w = ctx.level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  const tile = ctx.level.get(x, y);
  if (cell === hero.pos) {
    // Potion.onThrow: thrown at the hero -> apply(hero) (Potion.java:195-199)
    applyDrinkEffect(ctx, hero, id);
  } else if (tile === Terrain.WELL || tile === Terrain.CHASM) {
    // Well or pit/chasm: the potion survives (Potion.java:200-203)
    const fallback = POTION_DEFS[id]?.sprite ?? 'potion_red';
    ctx.level.items.push({
      pos: cell,
      itemId: id,
      sprite: potionSprite(id, fallback),
    });
  } else {
    shatterPotionAt(ctx, hero, cell, id);
  }
  return TIME_TO_THROW;
}

/**
 * Potion.shatter(cell): default is a harmless splash (Potion.java:211-219).
 * Only ToxicGas/ParalyticGas/LiquidFlame/Frost/Purity override it.
 */
export function shatterPotionAt(
  ctx: ActionContext,
  hero: ContentHero,
  cell: number,
  id: string,
): void {
  const visible = isCellVisible(ctx, cell);
  switch (id) {
    case 'potion_toxicgas': {
      // PotionOfToxicGas.java:34-42: identify + splash if visible, seed ToxicGas 1000
      if (visible) knowPotion(id);
      seedBlob(ctx.level.blobs, 'toxic', cell, 1000, ctx.level.w * ctx.level.h);
      break;
    }
    case 'potion_paralyticgas': {
      // PotionOfParalyticGas.java:34-43
      if (visible) knowPotion(id);
      seedBlob(ctx.level.blobs, 'paralytic', cell, 1000, ctx.level.w * ctx.level.h);
      break;
    }
    case 'potion_liquidflame': {
      // PotionOfLiquidFlame.java:34-43
      if (visible) knowPotion(id);
      seedBlob(ctx.level.blobs, 'fire', cell, 2, ctx.level.w * ctx.level.h);
      break;
    }
    case 'potion_frost': {
      // PotionOfFrost.java:34-54
      const affected = cellsWithin2(ctx, cell);
      const anyVisible = affected.some((c) => isCellVisible(ctx, c));
      if (anyVisible) knowPotion(id);
      for (const c of affected) {
        const ch = charAtCell(ctx, hero, c);
        if (ch) {
          // Buff.prolong(ch, Frost.class, 5 * Random.Float(1, 1.5));
          // Frost.attachTo (Frost.java:62-65): paralysed = true, detach Burning.
          prolongBuff(ch.buffs, 'frost', 5 * ctx.rng.float(1, 1.5));
          ch.paralysed = true;
          delete ch.buffs.burning;
        }
      }
      // Freezing.affect: extinguish fire on every affected cell
      const fire = ctx.level.blobs.find((b) => b.kind === 'fire');
      if (fire) for (const c of affected) fire.cur[c] = 0;
      break;
    }
    case 'potion_purity': {
      // PotionOfPurity.java:43-57: clears ToxicGas + ParalyticGas within distance 2
      for (const c of cellsWithin2(ctx, cell)) {
        for (const kind of ['toxic', 'paralytic'] as const) {
          const blob = ctx.level.blobs.find((b) => b.kind === kind);
          if (blob && blob.cur[c] > 0) {
            blob.volume -= blob.cur[c];
            blob.cur[c] = 0;
          }
        }
      }
      break;
    }
    default:
      // Default shatter: harmless splash (Potion.java:211-219).
      break;
  }
}

// ---------------------------------------------------------------------------
// Small world helpers
// ---------------------------------------------------------------------------

/** Cells with chebyshev/level distance <= 2 through non-LOS-blocking cells. */
export function cellsWithin2(ctx: ActionContext, cell: number): number[] {
  const w = ctx.level.w;
  const h = ctx.level.h;
  const out: number[] = [];
  // PathFinder.buildDistanceMap(cell, BArray.not(Level.losBlockers, null), 2)
  const dist = new Int32Array(w * h).fill(-1);
  dist[cell] = 0;
  const queue = [cell];
  while (queue.length > 0) {
    const c = queue.shift()!;
    if (dist[c]! >= 2) continue;
    const cx = c % w;
    const cy = Math.floor(c / w);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (dist[n] !== -1) continue;
      if (isOpaque(ctx, nx, ny)) continue;
      dist[n] = dist[c]! + 1;
      queue.push(n);
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (dist[i] !== -1) out.push(i);
  }
  return out;
}

function isOpaque(ctx: ActionContext, x: number, y: number): boolean {
  // Frost's cone stops at solid walls and doors (Ballistica stop); the
  // port's hidden-trap tiles are floor for this purpose.
  const t = ctx.level.get(x, y);
  return (
    t === Terrain.WALL ||
    t === Terrain.DOOR ||
    t === Terrain.DOOR_SECRET ||
    t === Terrain.BARRICADE
  );
}

function isCellVisible(ctx: ActionContext, cell: number): boolean {
  return !!ctx.level.visible[cell];
}

/** Hero or a living mob standing on `cell`, if any. */
interface CellChar {
  buffs: Partial<Record<BuffKind, BuffState>>;
  paralysed: boolean;
}

function charAtCell(
  ctx: ActionContext,
  hero: ContentHero,
  cell: number,
): CellChar | null {
  if (hero.pos === cell) return hero;
  const w = ctx.level.w;
  for (const m of ctx.mobs) {
    if (m.isAlive() && m.y * w + m.x === cell) {
      return m as unknown as CellChar;
    }
  }
  return null;
}

/**
 * FlavourBuff tick (Buff.java spend semantics): 1 turn passes; the buff
 * detaches at zero. Returns true while the buff is still active.
 */
function tickFlavourBuff(
  buffs: Partial<Record<BuffKind, { left: number }>>,
  kind: BuffKind,
): boolean {
  const b = buffs[kind];
  if (!b) return false;
  b.left -= 1;
  if (b.left <= 0) {
    delete buffs[kind];
    return false;
  }
  return true;
}

/**
 * Tick the consumable buffs this worker owns (frost + the timed
 * flavour buffs). Called from the shared tickBuffs for hero and mobs.
 * Each is a vanilla FlavourBuff: 1 turn per tick, expiry clears flags.
 */
export function tickPotionBuffs(
  buffs: Partial<Record<BuffKind, { left: number }>>,
  flags: { flying: boolean; paralysed: boolean },
  onSleepEnd?: () => void,
): void {
  // Also ticks the scroll debuffs (terror/rage/sleep): mobs.ts cannot
  // import scrolls.ts (MirrorImageMob extends ContentMob — evaluation
  // cycle), so the one shared ticker lives here.
  const hadSleep = !!buffs.sleep;
  for (const kind of [
    'frost',
    'levitation',
    'invisibility',
    'mindvision',
    'gasesimmunity',
    'terror',
    'rage',
    'sleep',
  ] as const) {
    tickFlavourBuff(buffs, kind);
  }
  // Lullaby: when the sleep buff lapses the mob wakes (aiState handled
  // by the caller, which owns the mob object).
  if (hadSleep && !buffs.sleep && onSleepEnd) onSleepEnd();
  // Frost.detach (Frost.java:73-77): paralysis ends when frost expires.
  if (!buffs.frost && flags.paralysed) {
    // Only clear paralysis that came from frost: if a real paralysis buff
    // is present it re-asserts the flag on its own tick.
    if (!buffs.paralysis) flags.paralysed = false;
  }
  // Levitation.detach (Levitation.java:32-35): flying ends.
  if (!buffs.levitation) flags.flying = false;
}

/** Re-export for the shared ticker (mobs.ts tickBuffs + hero ticker). */
export { tickFlavourBuff };

/** Shared inventory helpers (also used by scrolls.ts / honeypot.ts). */
export function takeFromSlot(
  hero: ContentHero,
  slot: number,
  n: number,
): boolean {
  const stack: ItemStack | undefined = hero.inventory[slot];
  if (!stack || stack.qty < n) return false;
  removeFromInventory(hero, slot, n);
  return true;
}

export function giveItem(hero: ContentHero, itemId: string, qty: number): void {
  addToInventory(hero, itemId, qty);
}
