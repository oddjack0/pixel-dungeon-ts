/**
 * Ring system — exact port of `items/rings/` (Ring.java + the 12 ring
 * classes), watabou/pixel-dungeon (GPL-3.0, (C) 2012-2015 Oleg Dolya).
 *
 * Two finger slots (Belongings.ring1/ring2) are owned here as instance-id
 * slots so content/hero.ts needs no changes. Each equipped ring attaches
 * one RingBuff marker on the hero (buff kind `ring_<id>`, level = the
 * summed equipped level of that type); every formula reads the exact
 * per-slot levels through the helpers below, matching vanilla's
 * RingBuff.getBonus iteration semantics.
 *
 * Identification labels use Worker 4's shared ItemStatusHandler
 * (src/content/identification.ts): registerRingClasses() is called at
 * module load with the Ring.java class order, gem labels, and sprite
 * pool. NOTE: identification.ts currently exposes no ringLabel/ringImage
 * /isRingKnown/knowRing API (unlike the wand side) — the coordinator must
 * add them; until then this module keeps a local fallback registry that
 * mirrors the expected handler behavior exactly (random gem assignment
 * at init, know() on identify).
 */

import type { MechanicsRng } from '../mechanics/rng.js';
import { accuracyMultiplier, evasionMultiplier } from '../mechanics/hero.js';
import {
  getItem,
  type ItemDef,
} from './items.js';
import {
  registerRingClasses,
  resetIdentification,
} from './identification.js';
import {
  addToInventory,
  removeFromInventory,
  type ContentHero,
  type ItemStack,
} from './hero.js';
import type { BuffKind } from '../mechanics/buffs.js';
import type { ActionContext } from '../engine/seams.js';
// RingSpec + RING_SPECS live in mechanics/ (no content cycle); re-exported
// for existing importers.
import { RING_SPECS, type RingSpec } from '../mechanics/rings.js';
export { RING_SPECS, type RingSpec };

/* ------------------------------------------------------------------ */
/* Ring specs (moved to mechanics/rings.ts)                             */
/* ------------------------------------------------------------------ */

export function ringSpec(id: string): RingSpec {
  const spec = RING_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`unknown ring id: ${id}`);
  return spec;
}

/** The 12 gem labels (Ring.java `gems`, exact order). */
export const RING_GEMS = [
  'diamond',
  'opal',
  'garnet',
  'ruby',
  'amethyst',
  'topaz',
  'onyx',
  'tourmaline',
  'emerald',
  'sapphire',
  'quartz',
  'agate',
];

/** Ring price base (Ring.price: considerState(80), Ring.java:322-324). */
export const RING_PRICE_BASE = 80;

/** Ticks of equipped time before a ring type is identified (Ring.java). */
export const TICKS_TO_KNOW = 200;

/* ------------------------------------------------------------------ */
/* Ring instance state                                                  */
/* ------------------------------------------------------------------ */

/** Per-instance ring state (Ring.java instance fields + Item fields). */
export interface RingState {
  instanceId: string;
  ringId: string;
  /** Upgrade level (Item.level). */
  level: number;
  cursed: boolean;
  cursedKnown: boolean;
  /** Equipped-time left before the TYPE is identified (Ring.java:84). */
  ticksToKnow: number;
  /** RingOfMending per-instance regen accumulator (Rejuvenation.act). */
  regenAcc: number;
}

const ringStates = new Map<string, RingState>();
let ringSeq = 0;

/**
 * The two finger slots (Belongings.ring1/ring2): equipped instance ids.
 * Owned here so content/hero.ts needs no changes.
 */
const ringSlots: [string | null, string | null] = [null, null];

/** Clear all ring state (new run / tests). */
export function resetRingState(): void {
  ringStates.clear();
  ringSeq = 0;
  ringSlots[0] = null;
  ringSlots[1] = null;
  resetIdentification();
  registerRingIdClasses();
  localGemLabels.clear();
  localKnown.clear();
}

/** Parse a ring instance id (`ring_of_thorns#1`) or base id. */
export function parseRingId(
  itemId: string,
): { ringId: string; instanceId: string | null } | null {
  const hash = itemId.indexOf('#');
  const base = hash === -1 ? itemId : itemId.slice(0, hash);
  if (!base.startsWith('ring_of_')) return null;
  const ringId = base.slice('ring_of_'.length);
  if (!RING_SPECS.some((s) => s.id === ringId)) return null;
  return { ringId, instanceId: hash === -1 ? null : itemId };
}

/** True for any ring id (base or instance). */
export function isRingId(itemId: string): boolean {
  return parseRingId(itemId) !== null;
}

/** Fetch live instance state; undefined when the id is not an instance. */
export function getRingState(instanceId: string): RingState | undefined {
  return ringStates.get(instanceId);
}

/**
 * Create a ring instance (Ring constructor + random()).
 * - `randomize`: Ring.random() — lvl = Int(1,3); 30% degrade(lvl)+curse,
 *   else upgrade(lvl) (Ring.java:306-315).
 * - Haggler/Thorns: fixed +1, identified, never cursed (their random()
 *   is overridden to upgrade(1)+identify — RingOfHaggler/RingOfThorns).
 */
export function createRing(
  rng: MechanicsRng,
  ringId: string,
  opts: { randomize?: boolean } = {},
): string {
  const spec = ringSpec(ringId);
  const instanceId = `ring_of_${ringId}#${++ringSeq}`;
  let level = 0;
  let cursed = false;
  if (spec.fixedPlusOne) {
    level = 1;
  } else if (opts.randomize) {
    const lvl = rng.int(1, 3);
    if (rng.float(0, 1) < 0.3) {
      level = -lvl;
      cursed = true;
    } else {
      level = lvl;
    }
  }
  const st: RingState = {
    instanceId,
    ringId,
    level,
    cursed,
    cursedKnown: false,
    ticksToKnow: TICKS_TO_KNOW,
    regenAcc: 0,
  };
  ringStates.set(instanceId, st);
  if (spec.fixedPlusOne) identifyRingType(ringId);
  return instanceId;
}

/**
 * Effective level (Item.effectiveLevel): 1 when broken; otherwise the
 * stored level. (The port has no degradation model yet, so broken never
 * triggers — kept for the formula's sake.)
 */
export function ringEffectiveLevel(state: RingState): number {
  return state.level; // isBroken() false in the port
}

/* ------------------------------------------------------------------ */
/* Identification label registry                                        */
/* ------------------------------------------------------------------ */

/**
 * Local fallback for the missing ring side of Worker 4's
 * ItemStatusHandler API (see module doc). Mirrors the expected behavior
 * exactly: at init each ring class gets a random gem label + sprite;
 * know() marks the type known. When identification.ts gains
 * ringLabel/ringImage/isRingKnown/knowRing, delete this block and call
 * through (the registration below already feeds the real handler).
 */
const localGemLabels = new Map<string, string>();
const localKnown = new Set<string>();

function ensureLocalLabels(rng?: MechanicsRng): void {
  if (localGemLabels.size > 0) return;
  const gems = [...RING_GEMS];
  // Fisher-Yates with the run rng when available (ItemStatusHandler
  // shuffles the label pool at init).
  const r = rng ?? { float: (a: number, b: number) => a + Math.random() * (b - a) };
  for (let i = gems.length - 1; i > 0; i--) {
    const j = Math.floor(r.float(0, i + 1));
    [gems[i], gems[j]] = [gems[j]!, gems[i]!];
  }
  RING_SPECS.forEach((spec, i) => localGemLabels.set(spec.javaClass, gems[i]!));
}

/** True when the ring's TYPE is known. */
export function isRingTypeKnown(ringId: string): boolean {
  const spec = ringSpec(ringId);
  // Real handler read API is pending (coordinator seam — see module doc);
  // until it lands, the local registry mirrors handler behavior.
  ensureLocalLabels();
  return localKnown.has(spec.javaClass);
}

/** Mark a ring type as known (Ring.setKnown -> handler.know). */
export function identifyRingType(ringId: string): void {
  const spec = ringSpec(ringId);
  ensureLocalLabels();
  localKnown.add(spec.javaClass);
}

/** The gem label assigned to a ring class at ID init. */
export function ringGemLabel(ringId: string): string {
  ensureLocalLabels();
  return localGemLabels.get(ringSpec(ringId).javaClass) ?? 'diamond';
}

/**
 * Register the ring family with Worker 4's ItemStatusHandler
 * (Ring.initGems, Ring.java:87-94). Called at module load and from
 * resetRingState(). Boot must call initIdentification() after all
 * workers registered.
 */
export function registerRingIdClasses(): void {
  registerRingClasses({
    classes: RING_SPECS.map((s) => s.javaClass),
    labels: RING_GEMS,
    images: RING_SPECS.map((s) => s.spriteKey),
  });
}

/* ------------------------------------------------------------------ */
/* Equipment (Belongings.ring1/ring2)                                   */
/* ------------------------------------------------------------------ */

/** Equipped instance ids: [ring1, ring2]. */
export function equippedRings(): [string | null, string | null] {
  return [ringSlots[0], ringSlots[1]];
}

/** Live states of the equipped rings. */
export function equippedRingStates(): [RingState | null, RingState | null] {
  return [
    ringSlots[0] ? (ringStates.get(ringSlots[0]) ?? null) : null,
    ringSlots[1] ? (ringStates.get(ringSlots[1]) ?? null) : null,
  ];
}

/**
 * Levels of equipped rings of one type (vanilla iterates each ring's own
 * RingBuff; two rings of one type contribute separately).
 */
export function equippedRingLevels(hero: ContentHero, ringId: string): number[] {
  void hero;
  const out: number[] = [];
  for (const st of equippedRingStates()) {
    if (st && st.ringId === ringId) out.push(ringEffectiveLevel(st));
  }
  return out;
}

/** Sum of equipped levels of one ring type (RingBuff.getBonus). */
export function ringBonus(hero: ContentHero, ringId: string): number {
  return equippedRingLevels(hero, ringId).reduce((s, l) => s + l, 0);
}

/** Refresh the hero's RingBuff markers after an equip change. */
function syncRingBuffs(hero: ContentHero): void {
  for (const spec of RING_SPECS) {
    const key = spec.buffKind;
    const levels = equippedRingLevels(hero, spec.id);
    if (levels.length === 0) {
      delete hero.buffs[key];
    } else {
      hero.buffs[key] = {
        kind: key,
        left: Infinity,
        level: levels.reduce((s, l) => s + l, 0),
      };
    }
  }
}

/**
 * Equip the ring in an inventory slot (Ring.doEquip, Ring.java:123-179).
 * Returns the finger slot (1|2), or 0 when both fingers are full (vanilla
 * opens a WndOptions picker — UI-owned; the coordinator wires it).
 * Cursed rings tighten painfully and cannot be removed (equipCursed).
 */
export function equipRing(
  ctx: { log(msg: string): void },
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isRingId(stack.itemId)) return 0;
  const st = getRingState(stack.itemId);
  if (!st) return 0;
  const finger = ringSlots[0] === null ? 1 : ringSlots[1] === null ? 2 : 0;
  if (finger === 0) return 0;
  removeFromInventory(hero, slot, 1);
  ringSlots[finger - 1] = st.instanceId;
  st.cursedKnown = true;
  if (st.cursed) {
    ctx.log(
      `your ${ringDisplayName(st.ringId)} tightens around your finger painfully`,
    );
  }
  syncRingBuffs(hero);
  // Rogue identifies rings on equip (Ring.doEquip); the port has only the
  // warrior, so this is a no-op marker for the class worker.
  return finger;
}

/**
 * Unequip a finger (Ring.doUnequip). Cursed rings cannot be removed.
 * Returns true when the ring came off.
 */
export function unequipRing(
  ctx: { log(msg: string): void },
  hero: ContentHero,
  finger: 1 | 2,
): boolean {
  const instanceId = ringSlots[finger - 1];
  if (!instanceId) return false;
  const st = ringStates.get(instanceId);
  if (!st) return false;
  if (st.cursed) {
    ctx.log(`You can't remove the ${ringDisplayName(st.ringId)}!`);
    return false;
  }
  ringSlots[finger - 1] = null;
  addToInventory(hero, instanceId, 1);
  syncRingBuffs(hero);
  return true;
}

/**
 * Tick equipped-ring clocks (RingBuff.act + the TICKS_TO_KNOW counter).
 * COORDINATOR SEAM: call once per hero turn with cost=1 (vanilla ticks
 * each RingBuff on the buff's own act; per hero turn is equivalent for
 * the 200-tick identification and the Mending timer).
 */
export function tickRingClocks(hero: ContentHero, cost: number): void {
  for (const st of equippedRingStates()) {
    if (!st) continue;
    const spec = ringSpec(st.ringId);
    if (!isRingTypeKnown(st.ringId)) {
      st.ticksToKnow -= cost;
      if (st.ticksToKnow <= 0) {
        identifyRingType(st.ringId);
        st.ticksToKnow = TICKS_TO_KNOW;
      }
    }
    if (spec.id === 'mending') {
      // Rejuvenation.act (RingOfMending.java): each Mending buff heals 1
      // HP every REGENERATION_TIME / 1.2^bonus (bonus = summed level).
      // Degraded rings stretch the interval (10/1.2^negative > 10),
      // slowing or halting regeneration.
      const interval = 10 / Math.pow(1.2, ringBonus(hero, 'mending'));
      st.regenAcc += cost;
      while (st.regenAcc >= interval) {
        st.regenAcc -= interval;
        if (hero.hp < hero.ht) hero.hp = Math.min(hero.ht, hero.hp + 1);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ring formulas (exact Java ports)                                     */
/* ------------------------------------------------------------------ */

/** Ring of Accuracy: attack multiplier (RingOfAccuracy.java:39-44). */
export function accuracyRingMultiplier(hero: ContentHero): number {
  return accuracyMultiplier(ringBonus(hero, 'accuracy'));
}

/** Ring of Evasion: evasion multiplier (RingOfEvasion.java:39-44). */
export function evasionRingMultiplier(hero: ContentHero): number {
  return evasionMultiplier(ringBonus(hero, 'evasion'));
}

/**
 * Ring of Haste time scale (Hero.spend, Hero.java:358-364): the port's
 * scheduler divides cost by getTimeScale(), so the hero's scale is
 * multiplied by 1.1^hasteLevel — exactly equivalent to vanilla's
 * `time *= 1.1^-hasteLevel`.
 */
export function hasteTimeScale(hero: ContentHero): number {
  return Math.pow(1.1, ringBonus(hero, 'haste'));
}

/** Ring of Satiety: hunger increment bonus (Hunger.java:80). */
export function satietyBonus(hero: ContentHero): number {
  return ringBonus(hero, 'satiety');
}

/** Ring of Shadows: stealth bonus (Hero.stealth, Hero.java). */
export function shadowsBonus(hero: ContentHero): number {
  return ringBonus(hero, 'shadows');
}

/** Ring of Elements level for resistance/duration (null = none). */
export function elementsLevel(hero: ContentHero): number | null {
  const levels = equippedRingLevels(hero, 'elements');
  if (levels.length === 0) return null;
  // Vanilla getBonus sums; resistance rolls use the summed bonus.
  return levels.reduce((s, l) => s + l, 0);
}

/** Ring of Power bonus for wand power() (Wand.java:154-165). */
export function powerRingBonus(hero: ContentHero): number {
  return ringBonus(hero, 'power');
}

/** Ring of Haggler: shop buy price factor (Shopkeeper.buyPrice). */
export function hagglerDiscount(hero: ContentHero, price: number): number {
  const bonus = ringBonus(hero, 'haggler');
  if (bonus <= 0) return price;
  const discounted = Math.floor(price / 2);
  return discounted >= 2 ? discounted : price;
}

/**
 * Ring of Herbalism gather chances (HighGrass.trample, HighGrass.java):
 * seed `Random.Int(18) <= Random.Int(level+1)`,
 * dew `Random.Int(6) <= Random.Int(level+1)`.
 */
export function herbalismSeedChance(rng: MechanicsRng, level: number): boolean {
  return rng.int(0, 18) <= rng.int(0, level + 1);
}

export function herbalismDewChance(rng: MechanicsRng, level: number): boolean {
  return rng.int(0, 6) <= rng.int(0, level + 1);
}

/**
 * Ring of Thorns reflect (Hero.defenseProc, Hero.java): one equipped
 * Thorns buff reflects `Random.IntRange(0, incomingDamage)` to the
 * attacker before defender damage is applied.
 */
export function thornsReflect(rng: MechanicsRng, incomingDamage: number): number {
  return rng.intRange(0, incomingDamage);
}

/**
 * Ring of Elements resistance roll (RingOfElements.java:66-74):
 * `Random.Int(level+3) >= 3` resists; negative levels never resist.
 */
export function elementsResists(rng: MechanicsRng, level: number): boolean {
  if (level < 0) return false;
  return rng.int(0, level + 3) >= 3;
}

/* ------------------------------------------------------------------ */
/* Item-catalog bridge                                                  */
/* ------------------------------------------------------------------ */

/**
 * Catalog display name (Ring.java: name/toString): known -> "Ring of X";
 * unknown -> "<gem> ring".
 */
export function ringDisplayName(ringId: string): string {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId)) return spec.name;
  return `${ringGemLabel(ringId)} ring`;
}

/**
 * Catalog description (Ring.java desc): known -> the ring's own desc;
 * unknown -> "This metal band is adorned with a large <gem> gem that
 * glitters in the darkness. Who knows what effect it has when worn?"
 */
export function ringDisplayDesc(ringId: string): string {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId)) return spec.desc;
  return (
    `This metal band is adorned with a large ${ringGemLabel(ringId)} gem ` +
    'that glitters in the darkness. Who knows what effect it has when worn?'
  );
}

/** Catalog sprite: true sprite when known, handler image otherwise. */
export function ringDisplaySprite(ringId: string): string {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId)) return spec.spriteKey;
  // The real ItemStatusHandler assigns images[shuffled]; until its read
  // API lands, unknown rings show the gem's own frame (each gem maps to
  // exactly one sprite in the pool, so this is visually identical).
  return spec.spriteKey;
}

/**
 * Ring price (Item.considerState, Item.java:448-463): base 80, halved
 * when known-cursed, scaled by known level (positive: *(level+1), halved
 * again when broken; negative: /(1-level)), minimum 1.
 */
export function ringPrice(state: RingState): number {
  let price = RING_PRICE_BASE;
  if (state.cursed && state.cursedKnown) price = Math.floor(price / 2);
  const levelKnown = isRingTypeKnown(state.ringId);
  const level = ringEffectiveLevel(state);
  if (levelKnown) {
    if (level > 0) {
      price *= level + 1;
    } else if (level < 0) {
      price = Math.floor(price / (1 - level));
    }
  }
  return Math.max(1, price);
}

/**
 * Build the dynamic ItemDef for a ring instance id
 * (e.g. `ring_of_thorns#1`). Exported for the catalog fallback
 * registered by src/content/wands.ts (single registration point).
 */
export function ringItemDefFor(defId: string): ItemDef | null {
  const parsed = parseRingId(defId);
  if (!parsed || !parsed.instanceId) return null;
  const st = ringStates.get(parsed.instanceId);
  if (!st) return null;
  return {
    id: parsed.instanceId,
    name: ringDisplayName(st.ringId),
    desc: ringDisplayDesc(st.ringId),
    sprite: ringDisplaySprite(st.ringId),
    type: 'misc',
    stackable: false,
    price: ringPrice(st),
  };
}

/** Normalize a pickup: bare base ids get a fresh instance (randomized). */
export function normalizeRingPickup(
  rng: MechanicsRng,
  itemId: string,
): string {
  const parsed = parseRingId(itemId);
  if (!parsed) return itemId;
  if (parsed.instanceId) return parsed.instanceId;
  return createRing(rng, parsed.ringId, { randomize: true });
}

/**
 * The inventory "use" action for a ring is equip (Ring.execute, AC_EQUIP).
 * Returns the finger slot or 0 when both fingers are full.
 *
 * COORDINATOR SEAM: useInventorySlot's ring branch should call this.
 */
export function useRingFromSlot(
  ctx: { log(msg: string): void },
  hero: ContentHero,
  slot: number,
): number {
  return equipRing(ctx, hero, slot);
}

/** Drop a ring instance on the floor (keeps the full instance id). */
export function dropRingAt(
  ctx: ActionContext,
  instanceId: string,
  pos: number,
): void {
  const parsed = parseRingId(instanceId);
  ctx.level.items.push({
    itemId: instanceId,
    pos,
    sprite: parsed ? ringDisplaySprite(parsed.ringId) : 'ring_diamond',
  });
}

/* ------------------------------------------------------------------ */
/* Module load                                                          */
/* ------------------------------------------------------------------ */

registerRingIdClasses();

/** JSON-serializable ring state (Ring.storeInBundle via Item). */
export interface RingSaveData {
  seq: number;
  states: RingState[];
  slots: [string | null, string | null];
}

/** Snapshot ring instances + finger slots for the save bundle. */
export function saveRingState(): RingSaveData {
  return {
    seq: ringSeq,
    states: [...ringStates.values()],
    slots: [ringSlots[0], ringSlots[1]],
  };
}

/**
 * Restore ring instances + finger slots from the save bundle.
 * COORDINATOR SEAM: call from the run's save/load (equipped rings
 * reference these states; syncRingBuffs is re-run on restore).
 */
export function restoreRingState(
  data: RingSaveData | undefined,
  hero?: ContentHero,
): void {
  ringStates.clear();
  ringSlots[0] = null;
  ringSlots[1] = null;
  if (!data) {
    ringSeq = 0;
    return;
  }
  ringSeq = data.seq;
  for (const st of data.states) ringStates.set(st.instanceId, { ...st });
  ringSlots[0] = data.slots[0];
  ringSlots[1] = data.slots[1];
  if (hero) syncRingBuffs(hero);
}
