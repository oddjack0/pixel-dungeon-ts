# Gap Analysis — ITEMS (original Java vs TypeScript port)

Date: 2026-09-22. Ground truth: `~/workspace/pixel-dungeon-src`
(items in `src/com/watabou/pixeldungeon/items/` + `plants/`).
Port: `~/workspace/pixel-dungeon-v2/src` (M1 scope per SPEC:
short sword, darts, cloth armor, healing potion, strength potion,
ration, scroll placeholder, gold, iron key, skeleton key).

Classification: **PRESENT** = matches original. **PARTIAL** = exists
but simplified/differs. **MISSING** = not in port. File refs:
`J:` = java file under items/ (or named package); `P:` = port file.

---

## 1. MELEE WEAPONS — `J:items/weapon/melee/`

Original stats (all from `MeleeWeapon.java` + subclass files):

| Weapon | tier | ACU | DLY | min (lvl0) | max (lvl0) | STR req |
|---|---|---|---|---|---|---|
| Short sword (`ShortSword.java`) | 1 | 1.0 | 1.0 | 1 | 12 (override `max0()`) | 11 (override) |
| Dagger (`Dagger.java`) | 1 | 1.2 | 1.0 | 1 | 8 (=⌊10/1.2⌋) | 10 |
| Knuckleduster (`Knuckles.java`) | 1 | 1.0 | 0.5 | 1 | 5 (=10·0.5) | 10 |
| Quarterstaff (`Quarterstaff.java`) | 2 | 1.0 | 1.0 | 2 | 12 | 12 |
| Spear (`Spear.java`) | 2 | 1.0 | 1.5 | 2 | 18 (=12·1.5) | 12 |
| Mace (`Mace.java`) | 3 | 1.0 | 0.8 | 3 | 12 (=⌊16·0.8⌋) | 14 |
| Sword (`Sword.java`) | 3 | 1.0 | 1.0 | 3 | 16 | 14 |
| Longsword (`Longsword.java`) | 4 | 1.0 | 1.0 | 4 | 22 | 16 |
| Battle axe (`BattleAxe.java`) | 4 | 1.2 | 1.0 | 4 | 18 (=⌊22/1.2⌋) | 16 |
| Glaive (`Glaive.java`) | 5 | 1.0 | 1.0 | 5 | 30 | 18 |
| War hammer (`WarHammer.java`) | 5 | 1.2 | 1.0 | 5 | 25 (=⌊30/1.2⌋) | 18 |

Formulas (`MeleeWeapon.java:41-57`): min0 = tier; max0 =
(tier²−tier+10)/ACU·DLY (ShortSword overrides to 12);
min = min0 + level; max = max0 + level·tier (when not broken).
typicalSTR = 8 + 2·tier; each upgrade −1 STR (`MeleeWeapon.upgrade`).
`Weapon.java:152-157`: `upgrade(enchant)` — upgrading an already-
enchanted weapon with `enchant=false` can *erase* the enchantment
(`Random.Int(level()) > 0`); if not enchanted and `enchant=true`
it gains a *random different* enchantment (never the same one).
Short sword also has **REFORGE** (`ShortSword.java`: `AC_REFORGE`
when level > 0 — merge two weapons, transfers upgrades).

- Short sword → **PRESENT** (`P:src/content/items.ts` SHORT_SWORD:
  tier 1, min 1, max 12, str 11, acu 1, dly 1 — matches Java exactly).
- All other 10 melee weapons → **MISSING**.

## 2. MISSILE WEAPONS — `J:items/weapon/missiles/`

| Missile | min | max | special (on throw/hit) |
|---|---|---|---|
| Dart (`Dart.java`) | 1 | 4 | plain; thrown via `MissileWeapon` |
| Incendiary dart (`IncendiaryDart.java`) | 1 | 2 | ignites flammable cell (`Blob.seed(cell,4,Fire)`); on-hit Burning |
| Curare dart (`CurareDart.java`) | 1 | 3 | paralyzes defender (Paralysis, fixed duration) |
| Javelin (`Javelin.java`) | 2 | 15 | cripples defender |
| Shuriken (`Shuriken.java`) | 2 | 6 | plain |
| Tomahawk (`Tamahawk.java`) | 4 | 20 | inflicts Bleeding = damage |
| Boomerang (`Boomerang.java`) | 1+lvl | 4+2·lvl | **returns to thrower** (circleBack when thrown equipped); unique (not stackable), own durability `maxDurability()` |

`MissileWeapon` specifics: thrown damage uses `Weapon.damageRoll`;
excess-STR bonus rule — bonus applies iff
`(rangedWeapon != null) == (heroClass == HUNTRESS)`
(`Weapon.java:141`). Warrior throwing darts gets NO exStr bonus;
Huntress with equipped missile DOES. Port implements this exact
condition (`P:src/mechanics/hero.ts` `weaponDamageRoll`) — **PRESENT**
for the rule itself.

- Dart → **PRESENT** (`P:src/content/items.ts` DART, min 1/max 4 —
  matches; stackable; `random()` quantity 5..15 noted in comment).
- Incendiary dart, Curare dart, Javelin, Shuriken, Tomahawk,
  Boomerang → **MISSING** (incl. boomerang return-to-thrower).

## 3. WANDS — `J:items/wands/` (13)

Wand mechanics (`Wand.java`): initial charges = **2** (3 for Magic
Missile); max charges = min(initial + level, 9) on upgrade;
recharge via `Charger` buff — 40 turns / sqrt(1+effectiveLevel)
(`Wand.java:463-491`); `power()` = effectiveLevel (+Ring of Power
bonus); 40 uses to auto-identify; usable as melee (min/max from
`Wand.java:332-339`: tier = 1 + effectiveLevel/3). TIME_TO_ZAP = 1.
Wands are *not* in `Generator` drop tables with these probs? They are:
`Category.WAND` weight 4 with per-class probs
(Teleport 10, Slowness 10, Firebolt 15, Regrowth 6, Poison 10,
Blink 11, Lightning 15, Amok 10, Reach 6, Flock 10, MagicMissile 0,
Disintegration 5, Avalanche 5) (`Generator.java`).

| Wand | effect (from `onZap`) | note |
|---|---|---|
| Magic Missile (`WandOfMagicMissile.java`) | dmg Random.Int(1, 6 + 2·level) | charges 3; not randomly generated (prob 0) |
| Firebolt (`WandOfFirebolt.java`) | dmg Random.Int(1, 8 + level²); sets Burning; ignites flammable terrain | |
| Lightning (`WandOfLightning.java`) | arcs: dmg to all chained chars, half dmg to next link; water doubles dmg | "more targets = more dmg each" |
| Disintegration (`WandOfDisintegration.java`) | beam dmg lvl..(8 + lvl²/3), NormalIntRange | |
| Avalanche (`WandOfAvalanche.java`) | cone dmg Random.Int(2, 6 + (size−d)·2); chance Paralysis 2–6 | |
| Poison (`WandOfPoison.java`) | Poison set (5 + power())·durationFactor | |
| Amok (`WandOfAmok.java`) | Amok 3+power() + Vertigo on target | |
| Slowness (`WandOfSlowness.java`) | Slow (Slow.duration/3 + power()) | |
| Blink (`WandOfBlink.java`) | hero teleports to target cell | |
| Teleportation (`WandOfTeleportation.java`) | teleports hero or target char | self-target = ScrollOfTeleportation.teleportHero |
| Flock (`WandOfFlock.java`) | spawns sheep(s) at cell | |
| Regrowth (`WandOfRegrowth.java`) | turns empty cells into grass along beam | |
| Reach (`WandOfReach.java`) | "reaches" — pushes/grabs: reach = min(Ballistica.distance, power()+4); moves chars/items along beam | |

All 13 wands → **MISSING** (no wand type in `P:src/content/items.ts`
`ItemType` at all).

## 4. ARMOR — `J:items/armor/` + `glyphs/` (11)

| Armor | tier | STR req (7+2·tier) | DR (lvl0) |
|---|---|---|---|
| Cloth (`ClothArmor.java`) | 1 | 9 | 2 |
| Leather (`LeatherArmor.java`) | 2 | 11 | 4 |
| Mail (`MailArmor.java`) | 3 | 13 | 6 |
| Scale (`ScaleArmor.java`) | 4 | 15 | 8 |
| Plate (`PlateArmor.java`) | 5 | 17 | 10 |

DR() = tier·(2 + effectiveLevel + glyph?1:0) (`Armor.java:145-147`).
Each upgrade −1 STR. 10% chance inscription on `random()`
(`Armor.java` random). Class armors (Warrior/Mage/Rogue/Huntress
`ClassArmor.java` + subclasses): tier 6, class-specific specials —
Warrior "Heroic Leap", Mage "Molten Earth", Rogue "Smoke Bomb",
Huntress "Spectral Blades" (each `AC_SPECIAL` + `doSpecial()`).

**Glyphs** (`J:items/armor/glyphs/`, 11): Affection (mutual Charm),
AntiEntropy (freeze attacker / burn defender), AutoRepair
(spends tier gold per hit to polish durability), Bounce (push
attacker), Displacement (teleport defender when not boss level),
Entanglement (Roots defender + Earthroot armor),
Metabolism (heal at hunger cost), Multiplicity (spawn mirror
image), Potential (lightning damages both), Stench (toxic gas
cloud), Viscosity (defer damage via DeferedDamage buff).
Random glyph chance 1/10 on `Armor.random()`.

- Cloth armor → **PRESENT** (`P:src/content/items.ts` CLOTH_ARMOR:
  str 9, dr 2 — matches tier 1 formulas). Port comment says
  "effective DR is dr + level" — equals vanilla's tier·(2+level)
  only for tier 1 (2+level ≡ 1·(2+level)) — **verify for higher tiers
  later** (see Open Questions).
- Leather, Mail, Scale, Plate armor → **MISSING**.
- Class armors + 4 class specials → **MISSING**.
- All 11 glyphs → **MISSING** (no glyph field in `P` `ArmorDef`).

## 5. RINGS — `J:items/rings/` (12)

Ring mechanics (`Ring.java`): 40 uses to know; buffs apply when
worn in ring1/ring2; negative levels possible when cursed.

| Ring | buff effect |
|---|---|
| Accuracy (`RingOfAccuracy`) | attack accuracy ×1.4^bonus (`Hero.attackSkill`) |
| Evasion (`RingOfEvasion`) | evasion ×1.2^bonus (`Hero.defenseSkill`) |
| Haste (`RingOfHaste`) | time spent ×1.1^(−hasteLevel) |
| Strength — n/a; see below | |
| Power (`RingOfPower`) | boosts wand `power()` |
| Elements (`RingOfElements`) | resist: Random.Int(level+3)≥3 → dmg factor (2+0.5·level)/(2+level) |
| Mending (`RingOfMending`) | regen interval ÷1.2^bonus |
| Satiety (`RingOfSatiety`) | hunger step −bonus |
| Shadows (`RingOfShadows`) | stealth +level |
| Thorns (`RingOfThorns`) | reflect Random.IntRange(0, damage) |
| Detection (`RingOfDetection`) | search radius = max positive bonus (negatives stack) |
| Haggler (`RingOfHaggler`) | shop prices (Haggling buff; no in-world use found in this version) |
| Herbalism (`RingOfHerbalism`) | dew/seed bonus in HighGrass (`HighGrass.java:47`) |

All 12 rings → **MISSING** (no ring type in port `ItemType`).

## 6. POTIONS — `J:items/potions/` (13 incl. base)

Drinking: TIME_TO_DRINK = 1 (`Potion.java:53`). Random-drop probs
(`Generator.java`): Healing 45, Exp 4, ToxicGas 15, ParalyticGas 10,
LiquidFlame 15, Levitation 10, Strength 0 (quest-only), MindVision 20,
Purity 12, Invisibility 10, Might 0 (alchemy only), Frost 10.

| Potion | effect |
|---|---|
| Healing (`PotionOfHealing`) | HP→HT; cures Poison, Cripple, Weakness, Bleeding |
| Strength (`PotionOfStrength`) | STR+1 permanent |
| Might (`PotionOfMight`) | STR+1 AND HT+5, HP+5 (extends Strength) |
| Experience (`PotionOfExperience`) | +1 hero level |
| Frost (`PotionOfFrost`) | thrown: freezes chars/cells (extinguishes Fire) |
| Liquid Flame (`PotionOfLiquidFlame`) | thrown: Fire blob |
| Toxic Gas (`PotionOfToxicGas`) | thrown: ToxicGas blob |
| Paralytic Gas (`PotionOfParalyticGas`) | thrown: ParalyticGas blob |
| Levitation (`PotionOfLevitation`) | Levitation buff |
| Invisibility (`PotionOfInvisibility`) | Invisibility buff |
| Mind Vision (`PotionOfMindVision`) | MindVision buff |
| Purity (`PotionOfPurity`) | GasesImmunity buff |

- Healing → **PRESENT** (heals full + cures poison; `P:actions.ts`).
  Note: vanilla `heal()` also cures Cripple, Weakness, Bleeding —
  **PARTIAL** if port only cures poison (code comment says "cures
  the M1 poison buff" — those other buffs don't exist in M1).
- Strength → **PRESENT** (STR++; `P:items.ts`).
- Other 10 potions → **MISSING**. Potion *throwing* (shatter on
  throw for all 13) → **MISSING**.

## 7. SCROLLS — `J:items/scrolls/` (13 + base)

TIME_TO_READ = 1. Random-drop probs (`Generator.java`): Identify 30,
Teleportation 10, RemoveCurse 15, Recharging 10, MagicMapping 15,
Challenge 12, Terror 8, Lullaby 8, PsionicBlast 4, MirrorImage 6,
Upgrade 0 (not random), Enchantment 1, WipeOut — debug only (not in
Generator; name "Scroll of Wipe Out").

| Scroll | effect |
|---|---|
| Upgrade (`ScrollOfUpgrade`) | uncurse target; if broken → **fix** instead of upgrade; else +1 upgrade |
| Identify (`ScrollOfIdentify`) | identify 1 item |
| Remove Curse (`ScrollOfRemoveCurse`) | uncurse all carried + equipped |
| Magic Mapping (`ScrollOfMagicMapping`) | reveal level map |
| Teleportation (`ScrollOfTeleportation`) | teleport hero to random cell |
| Recharging (`ScrollOfRecharging`) | recharge wands (`belongings.charge(true)`) |
| Challenge (`ScrollOfChallenge`) | enrage visible mobs (Rage) |
| Terror (`ScrollOfTerror`) | Terror on all mobs |
| Lullaby (`ScrollOfLullaby`) | Sleep on all mobs |
| Psionic Blast (`ScrollOfPsionicBlast`) | dmg all mobs 1..⅔·HT + Blindness (incl. hero) |
| Mirror Image (`ScrollOfMirrorImage`) | spawn mirror images |
| Enchantment (`ScrollOfEnchantment`) | add random enchantment to weapon |

- Scroll of Upgrade → **PARTIAL** (`P:src/content/actions.ts`:
  implements uncurse-attempt + upgrade, but comment admits
  "M1 has no curse model" and "M1 has no durability" so the
  broken-item→fix branch is missing).
- Generic "scroll" placeholder + other 11 → **MISSING**.
  Port note: no identification system at all in M1 (scrolls
  auto-identified; vanilla: rune labels, scrolls identify on read).

## 8. FOOD — `J:items/food/`

| Food | energy | special |
|---|---|---|
| Ration (`Food.java`) | Hunger.HUNGRY = 260 | warrior: +5 HP when hurt (`Food.java:74-82`); TIME_TO_EAT = 3 |
| Pasty (`Pasty.java`) | Hunger.STARVING | |
| Chargrilled meat (`ChargrilledMeat`) | STARVING−HUNGRY | cooked mystery meat (from burning) |
| Frozen carpaccio (`FrozenCarpaccio`) | STARVING−HUNGRY | 50/50: Invisibility or Barkskin ("skin hardens") |
| Mystery meat (`MysteryMeat`) | STARVING−HUNGRY | random: Burning / Roots(+paralysis msg) |
| Overpriced ration (`OverpricedRation`) | STARVING−HUNGRY | shop version |

- Ration → **PRESENT** (energy 260; `P:items.ts`). Warrior +5 HP on
  eat while hurt → check `P:actions.ts` (flagged below).
- Pasty, chargrilled meat, frozen carpaccio, mystery meat,
  overpriced ration → **MISSING**.

## 9. SEEDS & PLANTS — `J:plants/` (8)

`Plant.Seed` is a throwable item (plants when thrown onto valid
cell); stepping on plant triggers it. Seeds: Firebloom, Icecap,
Sorrowmoss, Dreamweed, Sungrass, Earthroot, Fadeleaf (Rotberry
prob 0 — not generated). High grass drops seeds.

| Plant | step effect |
|---|---|
| Firebloom | Fire blob (burns) |
| Icecap | extinguishes fire, Frost |
| Sorrowmoss | Poison (4 + depth/2)·durationFactor |
| Dreamweed | ConfusionGas blob (400) |
| Sungrass | Health buff (heal over time) |
| Earthroot | Armor buff (absorb = hero HT) |
| Fadeleaf | teleports stepper (hero) |
| Rotberry | ToxicGas blob (100) + Roots |

All plants/seeds → **MISSING** (no seed/plant type in port).

## 10. SPECIAL / QUEST ITEMS

- **Amulet of Yendor** (`J:Amulet.java`): depth 26 drop; pickup
  triggers descent→ascent phase; "END THE GAME" action on surface →
  **MISSING**.
- **Dew vial** (`J:DewVial.java`): collects dewdrops (max volume 10);
  drink to heal (TXT_VALUE "+NHP"); auto-drinks when hero low →
  **MISSING**. Dewdrop (`J:Dewdrop.java`): heals or fills vial →
  **MISSING**.
- **Ankh** (`J:Ankh.java`): resurrect on death; all non-equipped
  items lost; price 50 → **MISSING**.
- **Bomb** (`J:Bomb.java`): explodes on throw/ignite — dmg
  Random.Int(1+depth, 10+2·depth) − Random.Int(dr) to 3×3 area,
  Paralysis 2 to survivors, destroys flammable terrain →
  **MISSING**.
- **Honeypot** (`J:Honeypot.java`): shatter → spawns allied bee →
  **MISSING**.
- **Torch** (`J:Torch.java`) → **MISSING** (see Open Questions —
  effect unclear from quick read).
- **Weightstone** (`J:Weightstone.java`): imbue weapon SPEED
  (×0.6 time) or ACCURACY (×1.5) — one choice, not stackable →
  **MISSING**. Port has comment "M1: no Accuracy imbue" so the
  `Weapon.Imbue` mechanic is known-deferred.
- **Armor kit** (`J:ArmorKit.java`): converts armor to class armor →
  **MISSING**.
- **Tome of Mastery** (`J:TomeOfMastery.java`): choose subclass at
  level 10+ ("Tome of Remastery" if already chosen) → **MISSING**.
- **Lloyd's Beacon** (`J:LloydsBeacon.java`): SET/RETURN deep
  teleport (shop buy only, depth-limited) → **MISSING**.
- **Gold** (`J:Gold.java`) → **PRESENT** (purse model; port uses
  `gold:<n>` id convention; `Gold.random()` 20+10·depth ..
  40+20·depth cited in port).
- **Keys** (`J:keys/`): Iron key → **PRESENT**; Skeleton key →
  **PRESENT**; Golden key (`GoldenKey.java`, unlocks shop chests?)
  → **MISSING**.
- Quest items: corpse dust (`CorpseDust`), dark gold ore
  (`DarkGold`), dried rose (`DriedRose`), dwarf token
  (`DwarfToken`), phantom fish (`PhantomFish`), pickaxe
  (`Pickaxe`, MINE action + melee), giant rat skull
  (`RatSkull`) → all **MISSING**.
- **Bags** (`J:bags/`): Backpack, Keyring, ScrollHolder,
  SeedPouch, WandHolster (capacity 12/19 slots; Bag interface) →
  **MISSING** (port inventory model unknown — see Open Questions).

## 11. ITEM MECHANICS

- **Upgrade rules**: `Item.upgrade()` level+1; Scroll of Upgrade:
  uncurses + fixes broken instead of upgrading (see §7). Armor/
  weapon upgrade → STR−1. Max level: none enforced for scroll
  (shop/blacksmith caps later). → **PARTIAL** (port upgrades
  level only; no uncurse/fix/STR-reduction).
- **Enchantments** (`J:items/weapon/enchantments/`, 11 + base):
  Death (insta-kill chance 8%), Fire, Horror (Vertigo+Terror),
  Instability (random other), Leech (heal on hit),
  Luck (bonus damage reroll), Paralysis, Poison, Shock,
  Slow, Tempering (grows stronger with hits). `Enchantment.random()`
  on `Weapon.random()` 1/10 + Scroll of Enchantment. →
  **MISSING** entirely (no enchant field in port).
- **Curses** (`Item.cursed/cursedKnown`): generated degraded+cursed
  (`Weapon.random()` 40%: half upgrade n, half degrade n + cursed);
  cursed equipped items can't be unequipped; identified via use or
  Scroll of Remove Curse. → **MISSING** (port comment confirms).
- **Degradation**: **PRESENT in original** (this is the 2015-era
  codebase): every hit uses durability (`Item.use()`); broken at 0
  → stats revert to min0/max0, STR penalty returns; durability
  budgets: Weapon 5·(16−lvl), Armor/Wand 6·(16−lvl), Ring ∞ until
  lvl>1; warnings before breaking; repaired by Scroll of Upgrade
  (fix branch) or blacksmith reforge. → **MISSING** in port
  (acknowledged: "M1 has no durability").
- **Identification**: items have levelKnown/cursedKnown; weapons
  identify after 40? no — HITS_TO_KNOW hits; wands 40 zaps; potions/
  scrolls/wands/rings have random color/rune labels
  (`ItemStatusHandler`) until used; shop prices ×(unknown→flat).
  → **MISSING** in port (auto-identified; deferred to M2 per code).
- **Shop prices** (`price()` overrides): Melee 20·2^(tier−1)
  (×1.5 enchanted); Armor 10·2^(tier−1) (×1.5 glyphed); missiles
  dart 2, curare 12, incendiary 10, javelin 15, shuriken 15,
  tomahawk 20 (×qty); Wand 50 (considerState); Ring 80;
  Potions 20–200 when known (Healing 30, Strength 100, Might 200);
  Scrolls 15–100 (Identify 30, PsionicBlast 80, Upgrade: n/a —
  `ScrollOfUpgrade` has no price override → base 0??, WipeOut 100);
  Ankh 50; food Pasty 10? (check `Food.price`); `considerState`:
  cursed-known → ½; level>0 → ×(level+1) (½ if broken);
  level<0 → ÷(1−level). → **MISSING** (no shop in M1; price()
  model absent).
- **Drop probabilities** (`Generator.java` static): category weights
  WEAPON 15, ARMOR 10, POTION 50, SCROLL 40, WAND 4, RING 2,
  SEED 5, FOOD 0 (rations placed by level gen, not Generator),
  GOLD 50, MISC 5; per-class probs as listed in §§2,3,6,7,9.
  (ShortSword prob 0, Dart 0, Boomerang 0, MagicMissile 0,
  Strength 0, Might 0, Upgrade 0, Rotberry 0, Haggler 0, Thorns 0,
  MysteryMeat 0 — quest/fixed placement only.) →
  **MISSING** (port uses its own `spawns.ts`; Generator not ported).
- **Dewdrop drops**: `Dewdrop` random from high grass / mobs →
  **MISSING**.

## 12. WHAT THE PORT GETS RIGHT (M1 scope)

Short sword stats, dart stats, cloth armor stats/DR, potion of
healing (full + poison cure), potion of strength, ration energy
260, gold purse amounts, iron/skeleton keys, Scroll of Upgrade
basic +1 upgrade, weapon accuracy/speed factor formulas incl. the
Huntress-ranged exStr condition (`P:src/mechanics/hero.ts`),
weapon min/max with level scaling (`P:src/mechanics/hero.ts`
`weaponDamageRoll`), unarmed damage (STR>10 ? 1..STR−9 : 1).

---

## OPEN QUESTIONS (need parent/user or later-milestone answers; NOT decided)

1. **Warrior +5 HP on eating ration while hurt** (`Food.java:74-82`):
   does the port's eat action implement this? Couldn't confirm
   in the time available — check `P:src/content/actions.ts` eat().
2. **Armor DR formula generalization**: port stores `dr` + level;
   vanilla is `tier·(2+effectiveLevel+glyph?)`. Equivalent for all
   tiers *without* glyph, but glyph adds +tier. Needs a `glyph`
   field and DR adjustment when glyphs arrive.
3. **Torch effect**: `J:Torch.java` — quick read didn't surface its
   use (suspected: searching/light?). Needs a closer look at the file.
4. **Scroll of Upgrade price**: `ScrollOfUpgrade.java` has NO
   `price()` override → base `Item.price()` = 0?? Possibly
   intentional (never sold) or an upstream quirk. Flag, don't guess.
5. **Boomerang durability**: overrides `maxDurability()` — value not
   captured; needs reading `Boomerang.java`.
6. **Port inventory model**: no Bag types in port `ItemType`
   ('weapon'|'armor'|'missile'|'potion'|'food'|'scroll'|'gold'|'key').
   Capacity, keyring/scroll-holder/seed-pouch/wand-holster rules,
   and quickslot model are all unported — M2+ scope decision.
7. **MeleeWeapon max0 for Knuckles (DLY 0.5)**: (1−1+10)·0.5 = 5
   confirmed by formula; Dagger 8.33→8 via int cast — port must use
   integer truncation, not rounding, when these weapons arrive.
8. **Scroll of Wipe Out** (`ScrollOfWipeOut.java`) is debug-only
   (not in Generator) — confirm it's intentionally excluded from
   the port (it's a dev cheat that wipes the level).
