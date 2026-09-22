/**
 * Identification system (GPL-3.0; ground truth: watabou/pixel-dungeon,
 * `items/ItemStatusHandler.java`).
 *
 * Vanilla keeps one `ItemStatusHandler` per item family (potions, scrolls,
 * wands, rings). Each handler stores the ordered item type ids, a type ->
 * label map, a type -> image map, and the set of known types.
 *
 * New run (ItemStatusHandler.java:55-76): the label and image pools are
 * copied; for each item type one random index is chosen and the label AND
 * image at that index are assigned together, then both are removed from
 * their pools (labels and images always pair by shared index).
 *
 * Save/restore (ItemStatusHandler.java:100-136): per type, the image,
 * label and known flag are stored; restore re-applies known assignments
 * and randomly fills only the missing entries from the remaining pools.
 *
 * Auto-identification (ItemStatusHandler.java:86-96): when `know` is called
 * and only one unknown type remains, that last type is marked known too.
 *
 * Wand seam (items/wands/Wand.java:50, 352-357): wands identify by use —
 * `USAGES_TO_KNOW = 40`; each successful zap decrements the per-instance
 * counter and at zero the wand type is identified (charge becomes known).
 * Worker 3 (wands) registers the wand class list via `registerWandClasses`
 * before `initIdentification`; rings likewise via `registerRingClasses`.
 */
import type { MechanicsRng } from '../mechanics/rng.js';

/** Wand identification-by-use quota (Wand.java:50: USAGES_TO_KNOW = 40). */
export const WAND_USAGES_TO_KNOW = 40;

/**
 * Exact potion label pool (Potion.java:43-56: the 12 color strings, in
 * class order: Healing, Experience, ToxicGas, LiquidFlame, Strength,
 * ParalyticGas, Levitation, MindVision, Purity, Invisibility, Might,
 * Frost).
 */
export const POTION_COLORS: readonly string[] = [
  'turquoise',
  'crimson',
  'azure',
  'jade',
  'golden',
  'magenta',
  'charcoal',
  'ivory',
  'amber',
  'bistre',
  'indigo',
  'silver',
];

/**
 * Exact scroll label pool (Scroll.java:41-54: the 12 rune strings, in class
 * order: Identify, MagicMapping, Recharging, RemoveCurse, Teleportation,
 * Challenge, Terror, Lullaby, PsionicBlast, MirrorImage, Upgrade,
 * Enchantment).
 */
export const SCROLL_RUNES: readonly string[] = [
  'KAUNAN',
  'SOWILO',
  'LAGUZ',
  'YNGVI',
  'GYFU',
  'RAIDO',
  'ISAZ',
  'MANNAZ',
  'NAUDIZ',
  'BERKANAN',
  'ODAL',
  'TIWAZ',
];

/**
 * Exact potion image names (Potion.java:59-72), as extracted sprite keys.
 * Index i pairs with POTION_COLORS[i] (same random index, handler rule).
 */
export const POTION_IMAGES: readonly string[] = [
  'item_potion_turquoise',
  'item_potion_crimson',
  'item_potion_azure',
  'item_potion_jade',
  'item_potion_golden',
  'item_potion_magenta',
  'item_potion_charcoal',
  'item_potion_ivory',
  'item_potion_amber',
  'item_potion_bistre',
  'item_potion_indigo',
  'item_potion_silver',
];

/**
 * Exact scroll image names (Scroll.java:57-70), as extracted sprite keys.
 * Index i pairs with SCROLL_RUNES[i] (same random index, handler rule).
 */
export const SCROLL_IMAGES: readonly string[] = [
  'item_scroll_kaunan',
  'item_scroll_sowilo',
  'item_scroll_laguz',
  'item_scroll_yngvi',
  'item_scroll_gyfu',
  'item_scroll_raido',
  'item_scroll_isaz',
  'item_scroll_mannaz',
  'item_scroll_naudiz',
  'item_scroll_berkanan',
  'item_scroll_odal',
  'item_scroll_tiwaz',
];

/**
 * Generic status handler — port of ItemStatusHandler.java. `TId` is the
 * item-family catalog id (e.g. 'potion_experience').
 */
export class ItemStatusHandler {
  private readonly classes: string[];
  private readonly images = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private readonly knownSet = new Set<string>();

  constructor(
    classes: string[],
    labels: string[],
    images: string[],
    rng: Pick<MechanicsRng, 'int'>,
  ) {
    this.classes = [...classes];
    const labelPool = [...labels];
    const imagePool = [...images];
    // ItemStatusHandler.java:64-74 — one shared random index per type.
    for (const cls of classes) {
      const index = rng.int(0, labelPool.length); // Random.Int(0, n) -> [0, n)
      this.labels.set(cls, labelPool[index]!);
      this.images.set(cls, imagePool[index]!);
      labelPool.splice(index, 1);
      imagePool.splice(index, 1);
    }
  }

  /** Handler.image(item) (ItemStatusHandler.java:78-80). */
  image(cls: string): string {
    const img = this.images.get(cls);
    if (img === undefined) throw new Error(`unknown class ${cls}`);
    return img;
  }

  /** Handler.label(item) (ItemStatusHandler.java:82-84). */
  label(cls: string): string {
    const lbl = this.labels.get(cls);
    if (lbl === undefined) throw new Error(`unknown class ${cls}`);
    return lbl;
  }

  /** Handler.isKnown (ItemStatusHandler.java:140-142). */
  isKnown(cls: string): boolean {
    return this.knownSet.has(cls);
  }

  /**
   * Handler.know (ItemStatusHandler.java:86-96): marks known; when only
   * one unknown type remains, it becomes known automatically.
   */
  know(cls: string): void {
    if (!this.classes.includes(cls)) return;
    this.knownSet.add(cls);
    if (this.knownSet.size === this.classes.length - 1) {
      for (const c of this.classes) {
        if (!this.knownSet.has(c)) {
          this.knownSet.add(c);
          break;
        }
      }
    }
  }

  /** All known type ids. */
  known(): string[] {
    return this.classes.filter((c) => this.knownSet.has(c));
  }

  /** All still-unknown type ids. */
  unknown(): string[] {
    return this.classes.filter((c) => !this.knownSet.has(c));
  }

  /** All type ids in class order. */
  all(): string[] {
    return [...this.classes];
  }

  /** Serialized form (ItemStatusHandler.java:100-117). */
  save(): Record<string, { image: string; label: string; known: boolean }> {
    const out: Record<string, { image: string; label: string; known: boolean }> =
      {};
    for (const cls of this.classes) {
      out[cls] = {
        image: this.images.get(cls)!,
        label: this.labels.get(cls)!,
        known: this.knownSet.has(cls),
      };
    }
    return out;
  }

  /**
   * Restore (ItemStatusHandler.java:119-136): re-applies stored
   * assignments; missing entries are filled randomly from the remaining
   * label/image pools. `labels`/`images` are the full pools.
   */
  restore(
    data: Record<string, { image: string; label: string; known: boolean }>,
    labels: string[],
    images: string[],
    rng: Pick<MechanicsRng, 'int'>,
  ): void {
    this.images.clear();
    this.labels.clear();
    this.knownSet.clear();
    const labelPool = [...labels];
    const imagePool = [...images];
    for (const cls of this.classes) {
      const stored = data[cls];
      if (stored) {
        this.images.set(cls, stored.image);
        this.labels.set(cls, stored.label);
        const li = labelPool.indexOf(stored.label);
        if (li >= 0) labelPool.splice(li, 1);
        const ii = imagePool.indexOf(stored.image);
        if (ii >= 0) imagePool.splice(ii, 1);
        if (stored.known) this.knownSet.add(cls);
      }
    }
    // Randomly fill only the missing entries (Java:119-136).
    for (const cls of this.classes) {
      if (!this.images.has(cls) && labelPool.length > 0) {
        const index = rng.int(0, labelPool.length);
        this.labels.set(cls, labelPool[index]!);
        this.images.set(cls, imagePool[index]!);
        labelPool.splice(index, 1);
        imagePool.splice(index, 1);
      }
    }
  }
}

/** Class list + label/image pools for one item family. */
export interface FamilyDef {
  classes: string[];
  labels: string[];
  images: string[];
}

// ---------------------------------------------------------------------------
// Run state. Potions/scrolls register their catalog ids; wands/rings are
// registered by their workers BEFORE initIdentification runs.
// ---------------------------------------------------------------------------

let potionHandler: ItemStatusHandler | null = null;
let scrollHandler: ItemStatusHandler | null = null;
let wandHandler: ItemStatusHandler | null = null;
let ringHandler: ItemStatusHandler | null = null;

let potionDef: FamilyDef | null = null;
let scrollDef: FamilyDef | null = null;
let wandDef: FamilyDef | null = null;
let ringDef: FamilyDef | null = null;

/**
 * Worker 3 (wands) hook: register the wand class list (catalog ids in
 * Wand.java class order) plus its label/image pools (from Wand.java's
 * handler init). Must be called before `initIdentification`.
 */
export function registerWandClasses(def: FamilyDef): void {
  wandDef = def;
}

/** Ring worker hook (rings are not in Stage 2 scope). */
export function registerRingClasses(def: FamilyDef): void {
  ringDef = def;
}

/**
 * True once the ring worker has registered its class list. Mirrors
 * isWandRegistered(); the ring worker gates its run init on this.
 */
export function isRingRegistered(): boolean {
  return ringDef !== null;
}

/**
 * Start-of-run assignment for every registered family
 * (ItemStatusHandler.java:55-76).
 */
export function initIdentification(
  rng: Pick<MechanicsRng, 'int'>,
  potions: FamilyDef,
  scrolls: FamilyDef,
): void {
  potionDef = potions;
  scrollDef = scrolls;
  potionHandler = new ItemStatusHandler(
    potions.classes,
    potions.labels,
    potions.images,
    rng,
  );
  scrollHandler = new ItemStatusHandler(
    scrolls.classes,
    scrolls.labels,
    scrolls.images,
    rng,
  );
  wandHandler = wandDef
    ? new ItemStatusHandler(wandDef.classes, wandDef.labels, wandDef.images, rng)
    : null;
  ringHandler = ringDef
    ? new ItemStatusHandler(ringDef.classes, ringDef.labels, ringDef.images, rng)
    : null;
}

/** Clear all run state (tests). */
export function resetIdentification(): void {
  potionHandler = scrollHandler = wandHandler = ringHandler = null;
  potionDef = scrollDef = null;
  // Keep worker registrations: they are per-build, not per-run.
}

/** True once initIdentification has run for this run. */
export function identificationReady(): boolean {
  return potionHandler !== null && scrollHandler !== null;
}

function need<T>(h: T | null, what: string): T {
  if (!h) throw new Error(`identification not initialized (${what})`);
  return h;
}

// --- Potion API ------------------------------------------------------------

export function potionLabel(id: string): string {
  return need(potionHandler, 'potions').label(id);
}
export function potionImage(id: string): string {
  return need(potionHandler, 'potions').image(id);
}
export function isPotionKnown(id: string): boolean {
  return need(potionHandler, 'potions').isKnown(id);
}
export function knowPotion(id: string): void {
  need(potionHandler, 'potions').know(id);
}
export function knownPotions(): string[] {
  return need(potionHandler, 'potions').known();
}
export function unknownPotions(): string[] {
  return need(potionHandler, 'potions').unknown();
}

// --- Scroll API ------------------------------------------------------------

export function scrollRune(id: string): string {
  return need(scrollHandler, 'scrolls').label(id);
}
export function scrollImage(id: string): string {
  return need(scrollHandler, 'scrolls').image(id);
}
export function isScrollKnown(id: string): boolean {
  return need(scrollHandler, 'scrolls').isKnown(id);
}
export function knowScroll(id: string): void {
  need(scrollHandler, 'scrolls').know(id);
}
export function knownScrolls(): string[] {
  return need(scrollHandler, 'scrolls').known();
}
export function unknownScrolls(): string[] {
  return need(scrollHandler, 'scrolls').unknown();
}

// --- Wand API (Worker 3) ---------------------------------------------------

export function wandLabel(id: string): string {
  return need(wandHandler, 'wands').label(id);
}
export function wandImage(id: string): string {
  return need(wandHandler, 'wands').image(id);
}
export function isWandKnown(id: string): boolean {
  return need(wandHandler, 'wands').isKnown(id);
}
/** True once Worker 3 registered wand classes and initIdentification ran. */
export function isWandRegistered(): boolean {
  return wandHandler !== null;
}
export function knowWand(id: string): void {
  need(wandHandler, 'wands').know(id);
}
export function knownWands(): string[] {
  return need(wandHandler, 'wands').known();
}
export function unknownWands(): string[] {
  return need(wandHandler, 'wands').unknown();
}

// --- Save / restore ----------------------------------------------------------

export interface IdentificationSave {
  potions: Record<string, { image: string; label: string; known: boolean }>;
  scrolls: Record<string, { image: string; label: string; known: boolean }>;
  wands?: Record<string, { image: string; label: string; known: boolean }>;
  rings?: Record<string, { image: string; label: string; known: boolean }>;
}

/**
 * Serialize all handlers (ItemStatusHandler.java:100-117). The save
 * worker should persist this blob and call `restoreIdentification` on
 * load — the defs are re-registered by their workers at boot, before
 * restore runs.
 */
export function saveIdentification(): IdentificationSave {
  return {
    potions: need(potionHandler, 'potions').save(),
    scrolls: need(scrollHandler, 'scrolls').save(),
    ...(wandHandler ? { wands: wandHandler.save() } : {}),
    ...(ringHandler ? { rings: ringHandler.save() } : {}),
  };
}

/**
 * Restore after load (ItemStatusHandler.java:119-136). The family defs
 * must already be registered (potions/scrolls via the last
 * `initIdentification` args — pass them again here; wands/rings via
 * their `register*` calls).
 */
export function restoreIdentification(
  rng: Pick<MechanicsRng, 'int'>,
  data: IdentificationSave,
  potions: FamilyDef,
  scrolls: FamilyDef,
): void {
  initIdentification(rng, potions, scrolls);
  need(potionHandler, 'potions').restore(
    data.potions,
    potions.labels,
    potions.images,
    rng,
  );
  need(scrollHandler, 'scrolls').restore(
    data.scrolls,
    scrolls.labels,
    scrolls.images,
    rng,
  );
  if (data.wands && wandDef && wandHandler) {
    wandHandler.restore(data.wands, wandDef.labels, wandDef.images, rng);
  }
  if (data.rings && ringDef && ringHandler) {
    ringHandler.restore(data.rings, ringDef.labels, ringDef.images, rng);
  }
}
