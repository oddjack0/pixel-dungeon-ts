/**
 * Stage 1 item-catalog expansion tests — shop stock + Prison-reachable items.
 *
 * Every stat is asserted against the Java source cited in src/content/items.ts:
 * melee formulas (MeleeWeapon.java), armor formulas (Armor.java), and the
 * per-class price() overrides. Shop tags are the exact strings emitted by
 * paintShopRoom (ShopPainter.java via src/dungeon/shopPainter.ts).
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { ITEMS, getItem, parseItemId } from '../src/content/items.js';
import { resolveItemTag, resolveItemSpawns } from '../src/content/spawns.js';
import { unitPriceOf } from '../src/content/shopkeeper.js';

/** Every shop tag the shop worker emits, with its expected catalog id + unit price. */
const SHOP_TAGS: Array<[tag: string, id: string, price: number]> = [
  // Depth 6 (ShopPainter.java:103-109).
  ['quarterstaff', 'quarterstaff', 40],
  ['spear', 'spear', 40],
  ['leather-armor', 'leather_armor', 20],
  ['seed-pouch', 'seed_pouch', 50],
  ['weightstone', 'weightstone', 40],
  // Depth 11 (ShopPainter.java:111-117).
  ['sword', 'sword', 80],
  ['mace', 'mace', 80],
  ['mail-armor', 'mail_armor', 40],
  ['scroll-holder', 'scroll_holder', 50],
  // Depth 16 (ShopPainter.java:118-124).
  ['longsword', 'longsword', 160],
  ['battle-axe', 'battle_axe', 160],
  ['scale-armor', 'scale_armor', 80],
  ['wand-holster', 'wand_holster', 50],
  // Depth 21 (ShopPainter.java:125-132).
  ['glaive', 'glaive', 320],
  ['war-hammer', 'war_hammer', 320],
  ['plate-armor', 'plate_armor', 160],
  ['torch', 'torch', 10],
  // Common stock, every shop (ShopPainter.java:133-147).
  ['potion-of-healing', 'potion_healing', 20],
  ['scroll-of-identify', 'scroll_identify', 15],
  ['scroll-of-remove-curse', 'scroll_removecurse', 15],
  ['scroll-of-magic-mapping', 'scroll_magicmapping', 15],
  ['overpriced-ration', 'overpriced_ration', 20],
  ['ankh', 'ankh', 50],
];

describe('shop tag resolution', () => {
  for (const [tag, expectedId, expectedPrice] of SHOP_TAGS) {
    test(`tag ${tag} -> ${expectedId} with unit price ${expectedPrice}`, () => {
      const id = resolveItemTag(new RNG(42), 6, tag);
      expect(id).toBe(expectedId);
      expect(ITEMS[id]).toBeDefined();
      expect(unitPriceOf(id)).toBe(expectedPrice);
      expect(getItem(id).price).toBe(expectedPrice);
    });
  }

  test('random-potion resolves through the exact Generator (halves category weight)', () => {
    // ShopPainter.java:135 — Generator.random(Generator.Category.POTION).
    const id = resolveItemTag(new RNG(7), 11, 'random-potion');
    const { defId } = parseItemId(id);
    expect(ITEMS[defId]).toBeDefined();
    expect(getItem(defId).type).toBe('potion');
  });

  test('random-scroll resolves through the exact Generator', () => {
    const id = resolveItemTag(new RNG(7), 11, 'random-scroll');
    const { defId } = parseItemId(id);
    expect(ITEMS[defId]).toBeDefined();
    expect(getItem(defId).type).toBe('scroll');
  });

  test('FOR_SALE shop stock resolves to priced catalog items', () => {
    const tags = SHOP_TAGS.map(([tag]) => tag);
    const items = resolveItemSpawns(new RNG(9), 6, tags.map((tag) => ({ tag, heap: 'FOR_SALE' as const, pos: 0 })));
    expect(items).toHaveLength(tags.length);
    for (const it of items) {
      expect(it.forSale).toBe(true);
      const { defId } = parseItemId(it.itemId);
      expect(ITEMS[defId]).toBeDefined();
      expect(unitPriceOf(it.itemId)).toBeGreaterThan(0);
    }
  });
});

describe('weapon stats (MeleeWeapon.java:39-45, 77-79, 173-178)', () => {
  const cases: Array<[id: string, tier: number, min: number, max: number, str: number, acu: number, dly: number, price: number]> = [
    // [id, tier, min0=tier, max0=(tier^2-tier+10)/ACU*DLY, STR=8+tier*2, price=20*2^(tier-1)]
    ['quarterstaff', 2, 2, 12, 12, 1, 1, 40],
    ['spear', 2, 2, 18, 12, 1, 1.5, 40],
    ['sword', 3, 3, 16, 14, 1, 1, 80],
    ['mace', 3, 3, 12, 14, 1, 0.8, 80],
    ['longsword', 4, 4, 22, 16, 1, 1, 160],
    ['battle_axe', 4, 4, 18, 16, 1.2, 1, 160],
    ['glaive', 5, 5, 30, 18, 1, 1, 320],
    ['war_hammer', 5, 5, 25, 18, 1.2, 1, 320],
  ];
  for (const [id, tier, min, max, str, acu, dly, price] of cases) {
    test(`${id}: tier ${tier} stats`, () => {
      const def = getItem(id);
      const w = def.weapon!;
      expect(w.tier).toBe(tier);
      expect(w.level).toBe(0);
      expect(w.min).toBe(min); // min0() = tier (MeleeWeapon.java:39-41)
      expect(w.max).toBe(max); // max0() (MeleeWeapon.java:43-45)
      expect(w.str).toBe(str); // typicalSTR() = 8 + tier*2 (MeleeWeapon.java:77-79)
      expect(w.acu).toBe(acu);
      expect(w.dly).toBe(dly);
      expect(w.missile).toBe(false);
      expect(def.price).toBe(price); // 20 * 2^(tier-1) (MeleeWeapon.java:173-178)
      expect(def.type).toBe('weapon');
      expect(def.stackable).toBe(false);
    });
  }

  test('weapon prices follow 20 * 2^(tier-1)', () => {
    for (const def of Object.values(ITEMS)) {
      if (def.type === 'weapon' && def.weapon && def.id !== 'dart') {
        // The pickaxe is a quest item: it does not override price(), so
        // Item.price() = 0 (Item.java:444-446).
        if (def.id === 'pickaxe') {
          expect(def.price).toBe(0);
          continue;
        }
        expect(def.price).toBe(20 * 2 ** (def.weapon.tier - 1));
      }
    }
  });
});

describe('armor stats (Armor.java:145-147, 289-291, 298-303)', () => {
  const cases: Array<[id: string, tier: number, str: number, dr: number, price: number]> = [
    // [id, tier, STR=7+tier*2, DR=tier*2 (level 0), price=10*2^(tier-1)]
    ['leather_armor', 2, 11, 4, 20],
    ['mail_armor', 3, 13, 6, 40],
    ['scale_armor', 4, 15, 8, 80],
    ['plate_armor', 5, 17, 10, 160],
  ];
  for (const [id, , str, dr, price] of cases) {
    test(`${id}: str ${str}, dr ${dr}, price ${price}`, () => {
      const def = getItem(id);
      expect(def.armor!.str).toBe(str); // typicalSTR() (Armor.java:289-291)
      expect(def.armor!.dr).toBe(dr); // DR() = tier*2 at level 0 (Armor.java:145-147)
      expect(def.armor!.level).toBe(0);
      expect(def.price).toBe(price); // 10 * 2^(tier-1) (Armor.java:298-303)
      expect(def.type).toBe('armor');
    });
  }
});

describe('shop scrolls (unidentified price base, Scroll.java)', () => {
  const cases: Array<[id: string, name: string, sprite: string]> = [
    ['scroll_identify', 'Scroll of Identify', 'item_scroll_identify'],
    ['scroll_removecurse', 'Scroll of Remove Curse', 'item_scroll_removecurse'],
    ['scroll_magicmapping', 'Scroll of Magic Mapping', 'item_scroll_magicmapping'],
  ];
  for (const [id, name, sprite] of cases) {
    test(`${id}: name and unidentified price`, () => {
      const def = getItem(id);
      expect(def.name).toBe(name);
      expect(def.type).toBe('scroll');
      expect(def.stackable).toBe(true);
      // Scroll.price() = 15; the port has no identification, so the known
      // prices (30/30/25) never apply (ScrollOfIdentify.java etc).
      expect(def.price).toBe(15);
      expect(def.sprite).toBe(sprite);
    });
  }

  test('scroll descs are the vanilla strings', () => {
    expect(getItem('scroll_identify').desc).toBe(
      'Permanently reveals all of the secrets of a single item.',
    );
    expect(getItem('scroll_removecurse').desc).toContain('instantly strip from');
    expect(getItem('scroll_magicmapping').desc).toContain('crystal clarity');
  });
});

describe('bags, misc, and overpriced ration', () => {
  test('bags: price 50, type bag, no use action', () => {
    for (const [id, name] of [
      ['seed_pouch', 'seed pouch'],
      ['scroll_holder', 'scroll holder'],
      ['wand_holster', 'wand holster'],
    ] as const) {
      const def = getItem(id);
      expect(def.name).toBe(name);
      expect(def.type).toBe('bag');
      expect(def.stackable).toBe(false);
      expect(def.price).toBe(50); // SeedPouch.java / ScrollHolder.java / WandHolster.java
    }
  });

  test('weightstone/torch/ankh: stackable misc items with vanilla prices', () => {
    expect(getItem('weightstone').price).toBe(40); // Weightstone.java
    expect(getItem('torch').price).toBe(10); // Torch.java
    expect(getItem('ankh').price).toBe(50); // Ankh.java
    for (const id of ['weightstone', 'torch', 'ankh']) {
      const def = getItem(id);
      expect(def.type).toBe('misc');
      expect(def.stackable).toBe(true);
    }
  });

  test('overpriced ration: energy 100, price 20', () => {
    const def = getItem('overpriced_ration');
    expect(def.name).toBe('overpriced food ration'); // OverpricedRation.java
    expect(def.type).toBe('food');
    expect(def.energy).toBe(100); // STARVING - HUNGRY (Hunger.java:36-37)
    expect(def.price).toBe(20); // OverpricedRation.java
  });
});

describe('existing catalog prices (vanilla price() ground truth)', () => {
  const cases: Array<[id: string, price: number, why: string]> = [
    ['shortsword', 20, 'MeleeWeapon 20*2^(1-1)'],
    ['dart', 2, 'Dart.price() = quantity * 2 (per unit)'],
    ['cloth_armor', 10, 'Armor 10*2^(1-1)'],
    ['potion_healing', 20, 'unidentified Potion base (Potion.java)'],
    ['potion_strength', 20, 'no override -> Potion base 20'],
    ['ration', 10, 'Food.price() = 10'],
    ['scroll', 15, 'Scroll.price() = 15'],
    ['scroll_upgrade', 15, 'no override -> Scroll base 15'],
    ['gold', 0, 'Item.price() base'],
    ['iron_key', 0, 'Key: no override'],
    ['dewdrop', 0, 'Dewdrop: no override'],
    ['seed', 0, 'Plant.Seed: no override'],
  ];
  for (const [id, price, why] of cases) {
    test(`${id}: price ${price} (${why})`, () => {
      expect(getItem(id).price).toBe(price);
      expect(unitPriceOf(id)).toBe(price);
    });
  }
});

describe('new sprites exist in the extracted atlas', () => {
  test('every new catalog item has a sprite key in original_sprites', async () => {
    const { ORIGINAL_SPRITES } = await import('../src/assets/original_sprites.js');
    for (const id of [
      'quarterstaff', 'spear', 'sword', 'mace', 'longsword', 'battle_axe', 'glaive', 'war_hammer',
      'leather_armor', 'mail_armor', 'scale_armor', 'plate_armor',
      'seed_pouch', 'scroll_holder', 'wand_holster', 'weightstone', 'torch', 'ankh', 'overpriced_ration',
    ]) {
      const sprite = getItem(id).sprite;
      expect(ORIGINAL_SPRITES[sprite]).toBeDefined();
    }
  });
});
