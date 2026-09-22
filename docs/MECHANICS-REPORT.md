# Mechanics Report — Milestone 1 (Warrior, Sewers depths 1–4 + Goo)

Ground truth: original Java at `~/workspace/pixel-dungeon-src`
(`src/com/watabou/pixeldungeon/`). Java wins every conflict. Every formula
below cites the source file + line. Cross-checked against the verified oracle
(`~/workspace/pixel-dungeon-ts/src/`) and
`references/mechanics-reference.md` where noted.

Delivered modules (`src/mechanics/`): `rng.ts`, `char.ts`, `hero.ts`,
`combat.ts`, `exp.ts`, `hunger.ts`, `buffs.ts`, `goo.ts`.
Tests: `test/mechanics.test.ts` (bun test) — **51 pass, 0 fail**.
Typecheck: `tsc --noEmit --strict` clean on all modules + tests.

## RNG semantics

watabou's `com.watabou.utils.Random` is not vendored in the repo; bounds are
the standard watabou semantics documented in
`references/mechanics-reference.md` ("RNG conventions"):

| Java call | Range |
|---|---|
| `Random.Float(x)` | `[0, x)` |
| `Random.Float(a, b)` | `[a, b]` (unused in M1 combat math) |
| `Random.Int(a, b)` | `[a, b)` |
| `Random.Int(n)` | `[0, n)` |
| `Random.IntRange(a, b)` | `[a, b]` inclusive |
| `Random.NormalIntRange(a, b)` | triangular int in `[a, b]` inclusive |

`src/mechanics/rng.ts` implements the SPEC contract 5 interface
(`int`/`intRange`/`float`/`normalIntRange`/`pick`) as `createRng(seed)`
(mulberry32), a placeholder until the engine architect's `src/core/rng.ts`
lands — it will satisfy the interface structurally. `normalIntRange` is
implemented as sum-of-two-uniforms floored into `[min, max]` (triangular,
peaked at center), matching the documented NormalIntRange shape.

## Hit chance — `combat.hitRoll`

- `Char.hit(attacker, defender, magic)` — **Char.java:213-217**
  ```
  acuRoll = Random.Float(attacker.attackSkill(defender))
  defRoll = Random.Float(defender.defenseSkill(attacker))
  return (magic ? acuRoll * 2 : acuRoll) >= defRoll
  ```

## Melee / ranged attack — `combat.resolveAttack`

- `Char.attack` — **Char.java:128-186**
  1. `hit(this, enemy, false)`
  2. `dr = Random.IntRange(0, enemy.dr())` (**Char.java:143-144**). The
     SNIPER-subclass zero-dr branch (Char.java:143) is deferred to subclass
     hooks (not M1).
  3. `dmg = damageRoll()`
  4. `effectiveDamage = max(dmg - dr, 0)` (**Char.java:147**)
  5. `attackProc(enemy, effectiveDamage)` (**Char.java:149**)
  6. `enemy.defenseProc(this, effectiveDamage)` (**Char.java:150**)
  7. `enemy.damage(effectiveDamage, this)` (**Char.java:151**)

## Damage application — `combat.applyDamage`

- `Char.damage` — **Char.java:259-285**
  - immunities → `dmg = 0`; resistances → `dmg = Random.IntRange(0, dmg)`
    (**Char.java:263-267**)
  - paralysis break: if paralysed and `Random.Int(dmg) >= Random.Int(HP)`,
    paralysis detaches — evaluated even at `dmg == 0` (**Char.java:269-275**)
  - `HP -= dmg`; death at `HP <= 0` (**Char.java:278-283**)

## Warrior — `hero.ts`

- Start: `STR = STARTING_STR(10) + 1 = 11` (**Hero.java:131**,
  **HeroClass.java:134**); `HP = HT = 20` (**Hero.java:173**);
  `attackSkill = 10`, `defenseSkill = 5` (**Hero.java:139-140**);
  ShortSword equipped+identified, 8 Darts (**HeroClass.java:136-137**);
  ClothArmor equipped+identified, Food, Keyring (**HeroClass.java:119-123**).
- `heroAttackSkill` (**Hero.java:256-274**):
  `(attackSkill * accuracy * wep.acuracyFactor(hero))`, floored; adjacent
  throw halves accuracy (**Hero.java:262-264**). M1: no RingOfAccuracy.
  - `Weapon.acuracyFactor` (**Weapon.java:101-119**):
    `enc = STR - hero.STR()`; missile: warrior `+3`; factor =
    `enc > 0 ? ACU / 1.5^enc : ACU`.
  - Worked M1 values: melee ShortSword (STR 11) → factor 1 → **attackSkill 10**;
    dart (STR 10, enc = 10−11+3 = 2) → factor `1/1.5² = 4/9` →
    **dart attackSkill = ⌊10 × 4/9⌋ = 4** (adjacent: **2**).
- `heroDefenseSkill` (**Hero.java:276-305**): M1: no RingOfEvasion; paralysed
  halves evasion (**Hero.java:283-285**); `aEnc = armor.STR − STR()`;
  `aEnc > 0 ? ⌊def × ev / 1.5^aEnc⌋ : ⌊def × ev⌋`. Warrior in cloth (STR 9 vs
  11 → aEnc −2): **defenseSkill 5**.
- `heroDR` (**Hero.java:307-315**): `max(armor.DR(), 0)` = **2** (cloth).
  - `Armor.DR() = tier × (2 + effectiveLevel())` (**Armor.java:145-147**);
    `typicalSTR() = 7 + tier × 2` → cloth STR 9 (**Armor.java:289-291**).
- `heroDamageRoll` (**Hero.java:317-327**):
  `KindOfWeapon.damageRoll = Random.NormalIntRange(min, max)`
  (**KindOfWeapon.java:94-96**); `Weapon.damageRoll` adds `IntRange(0, exStr)`
  only when `(rangedWeapon != null) == (class == HUNTRESS)` (**Weapon.java:141**)
  → warrior melee and warrior throws both get **no** bonus.
  - ShortSword: tier 1 (`super(1, 1f, 1f)`, **ShortSword.java:54-55**),
    STR 11, `min = tier = 1` (**MeleeWeapon.java:41-42**),
    `max = max0() = 12` (**ShortSword.java:60-62**; cf. MeleeWeapon.java:55-57).
    → **NormalIntRange(1, 12)**.
  - Dart: min 1 / max 4 (**Dart.java:41-46**) → **NormalIntRange(1, 4)**.
  - Unarmed: `STR() > 10 ? Random.IntRange(1, STR() − 9) : 1` (**Hero.java:323**)
    → at STR 11: **1..2**.
  - `STR()` = `weakened ? STR − 2 : STR` (**Hero.java:182-184**).
- `heroAttackDelay` (**Hero.java:349-359**): `wep.speedFactor(hero)` =
  `enc > 0 ? DLY × 1.2^enc : DLY` (**Weapon.java:123-133**) → 1 for both
  starting weapons.
- `Hero.shoot` sets `rangedWeapon` for the attack then clears it
  (**Hero.java:246-254**).
- M1 omissions (later milestones): Fury, subclass attackProc cases
  (Gladiator/Berserker/Warlock/Sniper), rings, glyphs, `Hero.damage`
  subclass hooks (**Hero.java:805-877**). Weapon/armor `proc` does nothing to
  damage in M1 (MissileWeapon.proc only consumes the dart —
  **MissileWeapon.java:73-85**; Armor.proc is glyph-only — **Armor.java:187-191**).

## EXP — `exp.ts`

- `maxExp() = 5 + lvl × 5` (**Hero.java:1061-1063**): 10, 15, 20, 25, …
- `earnExp` (**Hero.java:1019-1041**): `while (exp >= maxExp()) { exp -=
  maxExp(); lvl++; HT += 5; HP += 5; attackSkill++; defenseSkill++; }`
  (Warlock post-level heal omitted — later milestone).
- Mob EXP (**Mob.java:68-69, 353-355**): `exp() = hero.lvl <= maxLvl ? EXP : 0`.

| Mob | EXP | maxLvl | Source |
|---|---|---|---|
| Rat | 1 (default) | 5 | Mob.java:68; Rat.java:34 |
| Gnoll | 2 | 8 | Gnoll.java:35-36 |
| Crab | 3 | 9 | Crab.java:36-37 |
| Swarm | 1 (default) | 10 | Mob.java:68; Swarm.java:47 |
| Skeleton | 5 | 10 | Skeleton.java:47-48 |
| Thief | 5 | 10 | Thief.java:48-49 |
| Goo | 10 | 30 (default) | Goo.java:52; Mob.java:69 |

## Hunger / regeneration — `hunger.ts`

- `STEP = 10`, `HUNGRY = 260`, `STARVING = 360` (**Hunger.java:34-37**).
- Not starving: `level += STEP` per act (**Hunger.java:80**; M1: no
  RingOfSatiety). Tick cadence `spend(STEP)` = 10 time units for warrior
  (**Hunger.java:108-109**).
- Starving: `Random.Float() < 0.3 && (HP > 1 || !paralysed)` → `damage(1, this)`
  (**Hunger.java:66-72**). **Starvation CAN kill a conscious hero at 1 HP**;
  only a paralysed 1-HP hero is spared.
- `satisfy(energy)`: `level −= energy`, clamped `[0, STARVING]`
  (**Hunger.java:113-121**). Ration energy = `Hunger.HUNGRY = 260`
  (**Food.java:41**).
- Regeneration: every 10 time units, `HP += 1` if `HP < HT` and not starving
  (**Regeneration.java:25-40**; M1: no RingOfMending).

## Buffs — `buffs.ts`

- **Burning** (**Burning.java**): `DURATION = 8` (48); per TICK:
  `damage(Random.Int(1, 5))` → **1..4** (75); `left −= TICK`; detach when
  `left <= 0 || Random.Float() > (2 + HP/HT)/3 || (water && !flying)`
  (96-105). `reignite` resets `left = duration(ch) = 8` (109-111, 128-131).
  M1 applier: FireTrap → fire blob (**FireTrap.java:34**).
- **Poison** (**Poison.java**): per TICK `damage((int)(left/3) + 1)`, then
  `left −= TICK`, detach at `left <= 0` (64-78). Duration set by applier
  (`set`, 52-54). M1: PoisonTrap →
  `durationFactor × (4 + depth/2)` (**PoisonTrap.java:34**) = 4, 5, 5, 6 on
  depths 1-4 (no RingOfElements in M1); Swarm split poisons clones for 2
  (**Swarm.java:120-128**). Tick damage for left=6 → 3,2,2,2,1,1 (tested).
- **Paralysis** (**Paralysis.java**): `DURATION = 10` (26); attach sets
  `paralysed = true` (27-35); detach clears via `unfreeze` (37-40, 51-57; no
  Frost in M1). Breaks on damage via combat (`Char.java:269-275`); halves hero
  evasion (**Hero.java:283-285**). M1 applier: ParalyticTrap → ParalyticGas,
  which prolongs by `Paralysis.duration(ch) = 10` (**ParalyticGas.java:36**).
- **Sleep**: `SWS = 1.5` (**Sleep.java:22**); `Mob.add(Sleep)` → SLEEPING state
  + `postpone(Sleep.SWS)` (**Mob.java:206-212**). *No M1 applier* (only
  ScrollOfLullaby — later milestone); ported for completeness.
- **Roots**: attach sets `rooted = true` unless flying (**Roots.java:28-36**);
  detach clears (38-42). *No M1 applier in the Sewers* (Web blob is later
  regions); ported for completeness.
- **Ooze** (**Ooze.java**): per TICK 1 damage (42-44); detaches in water
  (46-48). Included because Goo applies it.

## Goo — `goo.ts` (all from Goo.java)

- `HP = HT = 80` (51); `EXP = 10` (52); `defenseSkill = 12` (53); `dr() = 2`
  (77-79).
- `damageRoll`: pumpedUp ? `NormalIntRange(5, 30)` : `NormalIntRange(2, 12)`
  (64-69).
- `attackSkill`: `pumpedUp && !jumped ? 30 : 15` (72-74).
- `canAttack`: `pumpedUp ? dist <= 2 : adjacent` (95-97).
- `doAttack` (104-170): not pumped → 2/3 normal attack (`Random.Int(3) > 0`),
  1/3 pump up (`pumpedUp = true`, `spend(PUMP_UP_DELAY = 2)` — 46, 158-167).
  Pumped + adjacent → attack, `jumped = false`; pumped + dist 2 + clear
  ballistica → jump attack, `jumped = true` (attackSkill 15 — the "accuracy
  penalty"); pumped + blocked → `pumpedUp = false`, turn spent (144-148).
- `attack()` clears `pumpedUp` (176-180); `getCloser()` (moving) clears it
  (182-185).
- Water regen: `+1 HP`/turn in water while hurt (84-89).
- `attackProc`: `Random.Int(3) == 0` → apply Ooze (99-103).
- Resistances halve damage (`Random.IntRange(0, dmg)`): ToxicGas, Death
  glyph, ScrollOfPsionicBlast (228-233). No immunities.
- Goo `move` seals the boss level / `die` unseals + drops SkeletonKey (188-214)
  — engine/dungeon territory, not mechanics.

## Mob stats referenced (for content designer's table)

| Mob | HP | atk | def | damage | dr |
|---|---|---|---|---|---|
| Rat | 8 | 8 | 3 | NormalIntRange(1, 5) | 1 |
| Gnoll | 12 | 11 | 4 | NormalIntRange(2, 5) | 2 |
| Crab | 15 | 12 | 5 | NormalIntRange(3, 6) | 4 |
| Swarm | 80 (split halves) | 12 | 5 | NormalIntRange(1, 4) | 0 |
| Skeleton | 25 | 12 | 9 | NormalIntRange(3, 8) | 5 |
| Thief | 20 | 12 | 12 | NormalIntRange(1, 7) | 3 |
| Goo | 80 | 15 / 30 pumped | 12 | NormalIntRange(2, 12) / (5, 30) | 2 |

(Rat.java:31-48, Gnoll.java:32-53, Crab.java:32-54, Swarm.java:44-72,
Skeleton.java:44-53+98-105, Thief.java:45-97, Goo.java as above.)
Skeleton death burst: `max(0, damageRoll() − Random.IntRange(0, ch.dr()/2))`
to all adjacent living chars (**Skeleton.java:57-71**) — exposed as
`combat.skeletonDeathBurst`; engine triggers it.
Swarm split (`defenseProc`, **Swarm.java:76-107**) is mob-AI territory for
the content worker.

## Notes / open items for the coordinator

1. **No scaffold existed** when this work was done (`src/`, `test/`
   directories were empty; no `package.json`/`tsconfig`). Modules are
   standalone-importable; `bun test test/mechanics.test.ts` passes;
   `tsc --noEmit --strict` is clean. No `package.json`/`tsconfig.json` were
   created — the engine architect's scaffold (incl. `bun run typecheck`)
   should absorb these files; `src/mechanics/rng.ts` documents the swap to
   `src/core/rng.ts`.
2. **No escalations on fidelity.** Every ported formula has an unambiguous
   Java source. Two documentation-only caveats: (a) `Random.NormalIntRange`'s
   triangular shape is taken from the verified `mechanics-reference.md` RNG
   conventions (watabou's `Random.java` isn't vendored); (b) Sleep and Roots
   have no M1 appliers in the Sewers (verified by grep: only ScrollOfLullaby
   and later-region Web/Regrowth blobs apply them) — ported anyway per the
   task's buff-set scope.
3. Untouched per instructions: `~/workspace/pixel-dungeon-ts/`,
   `~/workspace/ts-spaces/pixel-dungeon-roguelike/`. Nothing published.
