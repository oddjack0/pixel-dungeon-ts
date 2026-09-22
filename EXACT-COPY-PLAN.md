# Pixel Dungeon — Exact-Copy Gap Analysis & Staged Plan

Date: 2026-09-22. Mandate (Bruno): EXACT copy of watabou/pixel-dungeon (GPL-3.0) —
mechanics, sprites, everything. Ground truth: `~/workspace/pixel-dungeon-src`.
Target: `~/workspace/pixel-dungeon-v2` (TypeScript, HTML5 Canvas).

Five read-only worker reports synthesized (heroes, mobs/bosses, levels/traps,
items, buffs/blobs/UI). Worker notes preserved at:
- `analysis/items-gap-analysis.md` (items, full)
- `GAP-BUFFS-BLOBS-UI.md` (buffs/blobs/UI, full)
- Hero + mobs reports in worker handoffs (no files saved)

---

## 1. CURRENT STATE (what exists, verified)

**In scope:** depths 1–5 (Sewers), Warrior only. 270/270 tests pass (bun),
typecheck clean, built to `dist/main.4325827568.js`, pushed to `main` (e3a2ff2).
Site: https://oddjack0.github.io/pixel-dungeon-ts/ (gh-pages deploy = parent's job).

**Faithful already (verified against Java):**
- Hero: Warrior base stats (HT 20, STR 10→11, attack/damage formulas), EXP
  curve (5·(lvl+1) exp, +1 HT/+1 STR per level, +1 accuracy/awareness per level),
  hunger thresholds (HUNGRY 260, STARVING 360, STEP 10), starvation damage/kill
  rules, satisfy() clamp, regen (10 ticks/+1 HP if not starving), search (doors),
  transition hunger cost (satisfy(-STARVING/10) on descend/ascend unless starving).
- Mobs M1: Rat, Gnoll, Crab, Swarm, Skeleton, Thief, Goo — stats/damage/AI states
  (sleeping/wandering/hunting/fleeing) faithful; Goo arena seal/unseal + skeleton
  key drop; Swarm clone copy (poison left=2); Ooze (Goo 1/3 apply, water wash-off).
- Items M1: short sword (tier 1, min1/max12, STR 11, acu 1, dly 1), darts
  (min1/max4, stackable, Huntress-ranged exStr condition), cloth armor (tier 1,
  DR 2), healing potion (full heal + poison cure), strength potion (STR+1),
  ration (260 energy, TIME_TO_EAT 3), gold purse amounts, iron/skeleton keys,
  Scroll of Upgrade (+1 upgrade, uncurse attempt).
- Systems: turn scheduler, FOV, dungeon gen (rooms/corridors), doors, stairs,
  traps tiles (visual only), chests/heaps, hunger clock, buffs (Burning, Poison,
  Paralysis, Sleep, Roots, Ooze, Hunger, Regeneration) with faithful tick formulas.

**Known M1 divergences (fixed today unless noted):**
- Transition hunger: FIXED (commit e3a2ff2).
- Awareness on level-up: MISSING (vanilla +1/lvl — hero report).
- Search: only secret doors; vanilla also reveals traps/hidden heaps, variable
  time cost — PARTIAL.
- Hero speed vs armor encumbrance: MISSING.
- Resurrection/Ankh/Dew Vial: MISSING.
- Goo `jumped` flag lifecycle: PARTIAL (verified different from vanilla).
- Swarm clone hostility: PARTIAL (needs vanilla AI check).
- Skeleton loot simplified (short sword); some M1 loot omitted — PARTIAL.
- Burning/Poison/Paralysis on hero: formulas present but UNREACHABLE — trap
  trigger system absent; also missing hero side effects (scrolls burn up when
  burning, MysteryMeat→ChargrilledMeat, buff attach messages "You catch fire!"
  etc., death messages, badge hooks).
- Buff HUD: canvas text badges; vanilla = 7×7 icon strip (Assets.BUFFS_SMALL).
- Slow/Speed time-scale (×0.5/×2.0 in Char.spend), Vertigo movement, Cripple
  speed×0.5: MISSING.
- Torch resolved: AC_LIGHT applies Light buff (DURATION 250, DISTANCE 4).

---

## 2. WHAT'S MISSING (full game scope)

### 2.1 Levels / depths / terrain / traps
- Chapters: Prison (6–10), Caves (11–15), City (16–20), LastShopLevel (21,
  shop; uses the city tileset per `LastShopLevel.tilesTex()`), Halls (22–24),
  Yog-Dzewa (25), LastLevel (26, Amulet), DeadEndLevel (27+).
  Boss levels: SewerBoss (exists, M1), PrisonBoss, CavesBoss, CityBoss,
  HallsBoss.
- Terrain tilesets per chapter (original `Terrain.java` tile flags; port renders
  canvas tiles — original tile PNGs should be extracted via the sprite pipeline).
- Traps (8, all trigger systems missing): Alarm, Fire, Gripping, Lightning,
  Paralytic, Poison, Summoning, Toxic. Vanilla placement (`placeTraps`): 0 on
  depth 1, else `Int(1, rooms+depth)` attempts, uniform over all 8 on every
  depth ≥ 2, hidden (SECRET_*) on EMPTY cells. Trigger: hero steps on SECRET_*
  → "A hidden pressure plate clicks!" + effect; revealed traps also trigger
  for the hero; **mobs trigger only revealed traps**; every trigger is
  single-use → INACTIVE_TRAP. Effects: Toxic = ToxicGas blob (300+20·depth);
  Fire = Fire blob 2; Paralytic = ParalyticGas (80+5·depth);
  Poison = (4+depth/2)·durationFactor; Alarm = beckons all mobs;
  Lightning = HP/3–2HP/3 + discharges a wand charge;
  Gripping = (depth+3)−DR/2 bleeding + Cripple; Summoning = 1–3 mobs (never on
  boss levels).
- Room system: standard rooms + special rooms (shops, alchemy, armory, treasury,
  library, statue, pool, garden, well rooms incl. WaterOfAwareness/Health/
  Transmutation wells, sacrificial fire, summoning, ritual site, weak floor).
- Level generator: RegularLevel painter (rooms/corridors/decorations), chapter
  builders (SewerLevel/PrisonLevel/CavesLevel/CityLevel/HallsLevel painters),
  feeling (BOSS/CHASM/WATER/GRASS/SECRETS), secrets, traps placement rates,
  mob spawn budgets per depth, item drop budgets per depth (Generator categories).

### 2.2 Heroes / classes
- Classes: Mage, Rogue, Huntress (+ Warrior already). 8 subclasses via Tome of
  Mastery at level 10+ (Gladiator/Berserker, Battlemage/Warlock, Assassin/
  Freerunner, Sniper/Warden). Subclass mechanics: Combo, Fury, SnipersMark,
  Shadows stealth, etc.
- Class systems: Mage wand recharge/init, Rogue stealth/detection, Huntress
  ranged bonuses; class armors + 4 class specials (Heroic Leap, Molten Earth,
  Smoke Bomb, Spectral Blades); Armor Kit.
- Inventory: bags (Backpack/Keyring/ScrollHolder/SeedPouch/WandHolster,
  capacities 12/19), item identification (levelKnown/cursedKnown,
  ItemStatusHandler labels), quickslots, 19-slot belt limit.
- Resurrection: Ankh (death → resurrect, lose non-equipped items), Dew Vial
  (10 volume, auto-drink when low), Dewdrops.
- Keys: golden key. Quest items: corpse dust, dark gold ore, dried rose,
  dwarf token, phantom fish, pickaxe (MINE), rat skull.

### 2.3 Mobs / bosses
- Regular mobs by chapter: Prison (Sewer crab→? actually: Skeleton, Thief
  (M1); Prison: Gnoll brute?, ... ) — full list per chapter from Java:
  Sewers: Rat, Gnoll, Crab, Swarm, Thief, Skeleton (+ Goo).
  Prison: Crazy thief? — exact: Spinner? No. Prison mobs: Gnoll Shaman?
  Let me not enumerate from memory — port must read mobs/*.java (39 files):
  includes Albino, Bandit, Bat, Brute, Crab, DM-100, Fly, Ghoul, Gnoll,
  GnollTrickster?, Golem, Goo, Guard, King, KingMinion?, Larva, Monk, NewbornElemental?,
  Piranha, Rat, Scorpion, Senior, Shaman, Shielded, Skeleton, Spinner, Statue,
  Succubus, Swarm, Thief, Wraith, Yog, YogFist?/Larva.
- Bosses: Tengu (Prison 10), DM-300 (Caves 15), Dwarf King (City 20),
  Yog-Dzewa (Halls 25) + minions (Yog's fists/larvae, King minions, DM-300
  pylons?).
- Special spawns: Piranha (water), Mimic (chests), Wraith (tombstones),
  Statue (statue rooms), CursePersonification? (cursed items?), Thief escape
  behavior, rare mob mutation (1/50 champion), respawning every 50 turns.

### 2.4 Items (worker: items-gap-analysis.md)
- Melee: 10 more (dagger, knuckles, quarterstaff, spear, mace, sword, longsword,
  battle axe, glaive, war hammer) + REFORGE (short sword merge) + Weightstone
  imbues (SPEED ×0.6 / ACCURACY ×1.5) + 11 enchantments + 11 glyphs + curses +
  durability/degradation (5·(16−lvl) weapons, 6·(16−lvl) armor/wands) +
  broken-state mechanics + Scroll of Upgrade fix-broken branch.
- Missiles: incendiary/curare darts, javelin, shuriken, tomahawk, boomerang
  (returns to thrower).
- Wands: all 13 (Magic Missile, Firebolt, Lightning, Disintegration, Avalanche,
  Poison, Amok, Slowness, Blink, Teleportation, Flock, Regrowth, Reach) +
  charge model (initial 2/3, max 9, Charger 40 turns/√(1+lvl)) + power() +
  40-zap identification + melee use.
- Armor: leather/mail/scale/plate + class armors; DR = tier·(2+level+glyph).
- Rings: all 12 (Accuracy, Evasion, Haste, Power, Elements, Mending, Satiety,
  Shadows, Thorns, Detection, Haggler, Herbalism) + negative cursed levels.
- Potions: 10 more (Might, Experience, Frost, LiquidFlame, ToxicGas,
  ParalyticGas, Levitation, Invisibility, MindVision, Purity) + THROWING
  (all 13 shatter) + random rune labels.
- Scrolls: 11 more (Identify, RemoveCurse, MagicMapping, Teleportation,
  Recharging, Challenge, Terror, Lullaby, PsionicBlast, MirrorImage,
  Enchantment) + random rune labels + read-to-identify.
- Food: pasty, chargrilled meat, frozen carpaccio, mystery meat (random bad
  effects), overpriced ration; warrior +5 HP on eat while hurt (verify port).
- Plants/seeds: all 8 (Firebloom, Icecap, Sorrowmoss, Dreamweed, Sungrass,
  Earthroot, Fadeleaf, Rotberry) — throwable seeds, step effects.
- Special: Amulet of Yendor (depth 26 → ascent phase → END THE GAME),
  Dew Vial, Ankh, Bomb (3×3, depth-scaled), Honeypot (ally bee), Torch,
  Tome of Mastery/Remastery, Lloyd's Beacon, golden key, quest items, bags.
- Generator drop tables (category weights + per-class probs) — port uses own
  spawns.ts; must be replaced with Generator.java tables.

### 2.5 Buffs / blobs / UI (worker: GAP-BUFFS-BLOBS-UI.md)
- Buffs missing: Frost, Amok, Charm, Slow, Speed, Cripple, Blindness, Terror,
  Rage, Vertigo, Barkskin, Light, MindVision, Invisibility, Shadows, Levitation,
  Awareness, GasesImmunity, Bleeding, Combo, Fury, SnipersMark, Weakness,
  SacrificialFire.Marked, RingOfElements.Resistance.
- Blob system: ENTIRELY absent — Fire, Freezing, ToxicGas, ParalyticGas,
  ConfusionGas, Regrowth, Web, SacrificialFire, **Alchemy** (potion cooking —
  confirmed present in vanilla via `AlchemyPot.java` + `actors/blobs/Alchemy.java`)
  (+ evolve ticks, seeding, rendering, Light blob).
- Wells: WaterOfAwareness/Health/Transmutation; Sacrificial Fire room;
  AlchemyPot cooking (potion combining → e.g. PotionOfMight).
- UI: title screen (exact: logo, play/rankings/badges buttons), class select,
  start-depth select?, game HUD (StatusPane exact layout, buff icon strip,
  toolbar, quickslots), menus (inventory, journal), dialogs (level-up, Tome of
  Mastery, sign/scroll text), game-over screen, victory screen, rankings table,
  badges screen, settings. Original UI assets (chrome, icons, buttons) should
  be extracted, not canvas-redrawn.

### 2.6 Meta / flow
- Save system: exact original (auto-save on quit/death? vanilla saves on
  quit via Bundlable; continue from save). Current: in-visit only.
- Rankings (score = gold + depth + level), badges (50+), challenges?,
  Journal, game over/victory flows, Amulet ascent phase (respawning hunters,
  "The Amulet screams..."?), surface ending.
- Sound: vanilla has sound effects (Assets.SND_*); mute-able. Music?
  (vanilla 1.7 has no music, SFX only.)
- Particles/effects: exact visual effects (hit sparks, zap beams, blob
  rendering, FOV fog). Canvas equivalents must match original look.

---

## 3. STAGED PLAN (chapter-based, each stage = port + verify + playtest)

**Stage 0 — M1 exactness cleanup (Sewers, Warrior).** Fix all known
divergences: Goo `jumped` lifecycle, Swarm clone hostility (verify vanilla AI),
awareness growth, full search (traps/hidden heaps, time costs), armor
encumbrance speed, M1 loot tables (Generator weights for depths 1–5),
trap TRIGGER system for the 8 traps (sewers-relevant: Gripping, Poison,
Fire, Paralytic, Toxic, Summoning, Lightning, Alarm), high grass (dewdrops/
seeds visuals only), burning/poison/paralysis hero side effects + attach
messages + death messages, Ooze text fix ("Caustic ooze eats your flesh.
Wash away it!"), buff icon strip (extract Assets.BUFFS_SMALL), wells
(WaterOfHealth/Awareness on early depths?), signs, locked chests/doors,
chasm. Sprite pass: extract remaining sewers assets (trap tiles, high grass,
well, sign, buff icons, status pane chrome). Deliverable: depths 1–5
pixel-identical in mechanics to vanilla; playtest win-rate sanity.

**Stage 1 — Prison (depths 6–10).** PrisonLevel painter, tileset, mobs
(full Prison roster from mobs/*.java), Tengu + PrisonBossLevel, new traps
density, items newly reachable (tier-2/3 weapons/armor, wands, rings,
potions/scrolls newly droppable per Generator), quest hooks if any
(RatSkull? — no, that's sewers ghost quest: GHOST quest + RatSkull +
  DriedRose on depths 2–4 — belongs in Stage 0/1), shop rooms appear?
  (vanilla shops: depths 6, 11, 16, 21 — LastShopLevel). Implement shop system
  (buy/sell, prices, Haggler).

**Stage 2 — Caves (depths 11–15).** CavesLevel, DM-300 + CavesBossLevel,
dark gold quest (DwarfToken?), blacksmith reforge (upgrade combine +
  enchant transfer), full wand/ring/enchantment/glyph/curse/durability systems
  (needed by now at latest).

**Stage 3 — City (depths 16–20).** CityLevel, Dwarf King + CityBossLevel,
imp quest (DwarfToken → ImpShop?), all remaining items (class armors via
  Armor Kit, Tome of Mastery → subclasses at 10+), full buff set, blob system
  complete, alchemy pot cooking (confirmed in vanilla: `AlchemyPot.java` +
  `actors/blobs/Alchemy.java` + POTIONS_COOKED badges).

**Stage 4 — Demon Halls (depths 21–25).** LastShopLevel (21, shop generation;
  city tileset), HallsLevel (22–24), Yog-Dzewa + HallsBossLevel (25) +
  fists/larvae, amulet drop (depth 26 = LastLevel),
  ascent phase mechanics, victory screen, rankings/badges.

**Stage 5 — Heroes complete.** Mage/Rogue/Huntress + all class systems,
  subclasses, class armors/specials; hero select screen; starting kits.

**Stage 6 — Exactness hardening.** Full UI (title, menus, dialogs, game over,
  settings), buff icon strip everywhere, original SFX, particles/effects pass,
  identification system, journal, challenges, save/continue exact flow,
  end-to-end winnable verification (bot playthrough 1–26 + human playtest),
  sprite/effect audit vs original assets.

Cross-cutting (do when first needed): blob system (Stage 0/1), trap triggers
(Stage 0), shop system (Stage 1), identification (Stage 2), save system (Stage 6).

---

## 4. OPEN QUESTIONS FOR BRUNO (judgment calls — do not guess)

1. **HUD buff display:** vanilla shows a 7×7 icon strip; port shows canvas text
   badges. Exact copy → extract original buff icons. OK to proceed?
   (Assumed yes under exact-copy mandate; flagging since HUD was called out.)
2. **Buff attach messages / death messages:** vanilla logs ("You catch fire!",
   "You starved to death...") + badge hooks. Port has no badge system yet.
   Implement messages now, badges in Stage 6? (Assumed yes.)
3. **Scroll of Wipe Out** is debug-only in vanilla (not in Generator). Exclude
   from port? (Assumed yes.)
4. **Scroll of Upgrade has no price() override** (base price 0) — preserve the
   quirk or treat as upstream bug? (Assumed preserve; it's never sold.)
5. **Freerunner "unencumbered"** description vs starvation-only mechanic:
   follow source code behavior (starvation check only). (Assumed yes.)
6. **SFX:** vanilla has sound effects, no music. Include original SFX
   (extracted) with mute toggle? (Assumed yes.)
7. **Save system:** vanilla saves on quit (Bundlable) and continues across
   visits. Replace current in-visit-only save? (Assumed yes, Stage 6.)
8. **Challenges** (vanilla has 4: no food, no armor, no healing, no herbalism?) —
   include? (Assumed yes, Stage 6, low cost.)

Resolved without Bruno: Torch = Light buff applier (verified in Torch.java);
weapon damage int truncation for Dagger/Knuckles (follow Java int casts);
Boomerang durability value (read Boomerang.java when porting).

---

## 5. PROGRESS LOG

- 2026-09-22: verified all 50 mapped sprites are genuine Watabou PNGs
  (pixel-perfect vs assets/); cache-busting build (hashed bundle); exact-copy
  fix #1 (transition hunger, Hero.actDescend/actAscend) committed e3a2ff2,
  270/270 tests + typecheck green; gap-analysis team completed (5 reports).
