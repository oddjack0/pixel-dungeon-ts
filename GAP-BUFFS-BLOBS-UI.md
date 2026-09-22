# GAP ANALYSIS — Buffs, Blobs & UI Flows (read-only)

**Date:** 2026-09-22 · **Scope:** `~/workspace/pixel-dungeon-src` (vanilla 1.7.x, Oleg Dolya) vs `~/workspace/pixel-dungeon-v2/src` (M1)
**Rule:** exact copy, no reinterpretation. Ambiguities are flagged as OPEN QUESTIONS, not decided.

---

## 1. BUFFS / DEBUFFS — vanilla `actors/buffs/*.java` (34 classes)

### 1a. Present in port (`src/mechanics/buffs.ts`, `src/mechanics/hunger.ts`)

| Buff | Vanilla spec (file:line) | Port status |
|---|---|---|
| **Burning** | DURATION=8 (Burning.java:48); tick: `Random.Int(1,5)` dmg, `left-=TICK`, detach when `left<=0 \|\| Random.Float()>(2+HP/HT)/3 \|\| (water && !flying)` (Burning.java:64-107); `reignite()` resets `left=duration(ch)` (109-111) | **PARTIAL** — tick formula faithfully ported (`burningTick`, reignite=8). **Missing:** hero on-fire side effects (random unequipped **scroll burns up** — vanilla Burning.java:79-90; **MysteryMeat→ChargrilledMeat** — 91-104; Thief's scroll destroyed); **Burning prolongs Light** on hero (68); burning char **seeds Fire blob** on flamable tile (94); `onDeath` → `Badges.validateDeathFromFire()` + "You burned to death..." (124-131). **Critical:** nothing in the port *applies* Burning to the hero — FireTrap tiles exist but the trap-trigger system is absent (see §3 trap row). Burning is currently unreachable in gameplay. |
| **Poison** | tick: dmg `(int)(left/3)+1`, `left-=TICK`, detach at 0 (Poison.java:64-78); duration set by applier `set(duration)` (52-54); `onDeath` → badge + "You died from poison..." (80-88) | **PARTIAL** — `poisonTick` faithful. **Missing:** appliers (PoisonTrap `4+depth/2` doesn't trigger; PotionOfToxicGas→blob absent); hero death message/badge. PotionOfHealing curing poison is present (`content/actions.ts:117-119`, matches PotionOfHealing.java:38-48). Swarm clone copies poison `left=2` — present (`content/mobs.ts:745`, matches Swarm.java:120-128). |
| **Paralysis** | DURATION=10 (Paralysis.java:26); attach sets `paralysed=true` (27-35); detach clears via `unfreeze` only if no Frost (37-57); damage can break it: `Random.Int(dmg)>=Random.Int(HP)` → detach + "The X is out of paralysis" (Char.java:266-273); paralysed **halves evasion** (Hero.java:283-285) | **PARTIAL** — duration + damage-break (`mechanics/combat.ts:25,99-122`, `content/mobs.ts:196-199`) + evasion interaction appear present. **Missing:** applier (ParalyticTrap doesn't trigger; ParalyticGas blob absent). Frost interplay N/A (no Frost). |
| **Sleep** | `SWS=1.5`; Mob.add(Sleep) → SLEEPING + postpone 1.5 (Mob.java:206-212; Sleep.java:22) | **PRESENT** — ported for completeness; no M1 applier (ScrollOfLullaby is later), matching vanilla. |
| **Roots** | attach sets `rooted=true` unless flying (Roots.java:28-36) | **PRESENT** — no M1 applier (Web blob is later regions), matching vanilla. |
| **Ooze** | tick: 1 dmg; detach in water (Ooze.java:39-50); Goo `attackProc` 1/3 chance applies (Goo.java:99-104) | **PRESENT** — `oozeTick`, Goo 1/3 apply (`content/goo-boss.ts:211`), water wash-off. **Text mismatch:** port logs "Caustic ooze covers you!"; vanilla GLog is **"Caustic ooze eats your flesh. Wash away it!"** (Hero.java:1091). |
| **Hunger** | STEP=10; HUNGRY=260; STARVING=360 (Hunger.java:34-37); starving: 30% chance 1 dmg per act, kills even at 1HP unless paralysed (66-72); rogue 1.2× step (108-109); `satisfy()` clamps [0,STARVING] (113-121); `onDeath` → badge + "You starved to death..." (132-139) | **PRESENT** — thresholds, starvation kill rule, satisfy clamp all faithful (`mechanics/hunger.ts`). HUD shows Hungry/Starving badges (`ui/hud.ts:142-160`). Shadows 1.5× interplay N/A (no Shadows). Missing: death message/badge (no badge system). |
| **Regeneration** | every 10 ticks +1 HP if HP<HT and not starving (Regeneration.java:25-46) | **PRESENT** — `regenTick` faithful. |

**Buff-attach messaging (vanilla `Hero.add`, Hero.java:1080-1112)** — vanilla logs on attach: "You catch fire!" / "You are paralysed!" / "You are poisoned!" / "You can't move!" / "You feel weakened!" / "You are blinded!" / "You become furious!" / "You are charmed!" / "You are crippled!" / "You are bleeding!" / "Everything is spinning around you!", plus `interrupt()` for Burning/Paralysis/Poison/Vertigo, and `BuffIndicator.refreshHero()`. → Port: **MISSING** (no equivalent per-buff attach messages; only the Ooze line above, with wrong text).

**Slow/Speed time-scale (`Char.spend`, Char.java:304-312)** — Slow ×0.5, Speed ×2.0 on all actor spending; Cripple halves `speed()` (Char.java:247-249). → Port: **MISSING** (no Slow/Speed/Cripple; `engine/loop.ts` scheduling has no time-scale hook).

**Vertigo movement** (`Char.move`, Char.java:476-480) — adjacent step → random of 8 neighbours, blocked if impassable/occupied. → Port: **MISSING** (no Vertigo; vanilla sewers *has* a ConfusionTrap applier).

### 1b. Missing from port entirely (no `BuffKind`, no mechanics)

| Buff | Vanilla spec | Notes / M1-relevance |
|---|---|---|
| **Frost** | DURATION=5 (Frost.java:32); attach: `paralysed=true`, **detaches Burning** (36-42); MysteryMeat→FrozenCarpaccio on hero (43-52); any `damage()` detaches Frost (Char.java:256) | No sewers applier (WandOfFrost/PotionOfFrost are later). Exact-copy still requires it. |
| **Amok** | FlavourBuff; mob AI: attacks nearest char, not just enemy (Mob.java:158,199) | Appliers: WandOfAmok, ScrollOfAmok(?), Monk/Golem mobs — later regions. |
| **Charm** | `object` = charmer id (Charm.java:25); `isCharmedBy` blocks attacks (Char.java:341-348); hero can't attack charmer (Hero.java:775) | Succubus/Yog/Affection glyph — later. |
| **Slow** | DURATION=10 (Slow.java:29); time-scale ×0.5 (Char.java:306-308) | Appliers: WandOfSlowness, Slow enchant, MysteryMeat(?), Weapon — some reachable later. |
| **Speed** | DURATION=10; time-scale ×2.0 (Char.java:309-311) | ScrollOfHaste. |
| **Cripple** | DURATION=10 (Cripple.java:29); `speed()` ×0.5 (Char.java:248) | Spider — later. |
| **Blindness** | FlavourBuff; `detach` → `Dungeon.observe()`; GLog "You are blinded!" | ScrollOfPsionicBlast, Bandit — later. |
| **Terror** | DURATION=10 (Terror.java:29); `object` = terror source id; mob flees (Mob.java:174-218); `Terror.recover` | ScrollOfTerror. |
| **Rage** | FlavourBuff; mob AI variant | ScrollOfRage. |
| **Vertigo** | DURATION=10 (Vertigo.java:29); random-step movement; GLog "Everything is spinning around you!" + interrupt | **M1-relevant: ConfusionTrap/ConfusionGas exists in sewers** (vanilla `actors/blobs/ConfusionGas.java`; GasesImmunity blocks it). Port has trap tiles but no trigger. |
| **Barkskin** | stacking armor level, ticks down 1/turn (Barkskin.java:34-50); adds to hero armor (Hero.java:309) | Earthroot seed/HighGrass, FrozenCarpaccio — later/deferred content. |
| **Light** | DURATION=250, DISTANCE=4 (Light.java:32-33); sets `viewDistance`, `Dungeon.observe()` | Torch item; also prolonged by Burning (see §1a). |
| **MindVision** | DURATION=20, distance=2 (MindVision.java:32-34) | PotionOfMindVision. |
| **Invisibility** | DURATION=15 (Invisibility.java:34); `invisible++`/`--`; `dispel()` when hero has visible enemies (89-94) | PotionOfInvisibility. |
| **Shadows** (Shadowmeld) | extends Invisibility; `left` ticks down 1 per 2 TICKs; breaks when enemies visible; `prolong()` sets left=2 (Shadows.java) | Rogue RingOfShadows — class-gated, later. |
| **Levitation** | DURATION=20 (Levitation.java:34); `flying=true`, detaches Roots; on detach `Level.press(pos)` (re-triggers traps!) | PotionOfLevitation. |
| **Awareness** | DURATION=2 (Awareness.java:34); detach → `Dungeon.observe()` | Magic-well WaterOfAwareness (see §2). |
| **GasesImmunity** | DURATION=5 (GasesImmunity.java:34); blocks Paralysis, ToxicGas, Vertigo (44-49) | PotionOfPurity. **M1-relevant alongside gas traps.** |
| **Bleeding** | level-based: tick dmg `Random.Int(level/2, level)`, detaches at 0 (Bleeding.java:62-93); "You bled to death..." + badge (86-89) | Later-region appliers. |
| **Combo** | count++; at ≥3: `postpone(1.41-count/10)`, bonus dmg `(count-2)/5`, GLog "%d hit combo!", `Badges.validateMasteryCombo` (Combo.java:52-71) | Gladiator subclass — later. |
| **Fury** | active while HP ≤ 40% HT (Fury.java:35-46); hero dmg ×1.5 (Hero.java:325) | Berserker subclass — later. |
| **SnipersMark** | `object` = enemy id; prolonged `attackDelay()*1.1` on ranged hit (Hero.java:835) | Sniper subclass — later. |
| **Weakness** | DURATION=40 (Weakness.java:32); sets `hero.weakened`, `belongings.discharge()` (uncharges wands!) (44-56) | Shaman — later. |
| **SacrificialFire.Marked** | DURATION=5; on detach-if-dead → `sacrifice()` (SacrificialFire.java:138-156) | Sacrificial-fire room (see §2). |
| **RingOfElements.Resistance** | scales durations of Burning/Poison/Paralysis/Frost/Slow/Charm/Vertigo/Weakness | No rings in M1 — correctly omitted. |

**Buff icon strip:** vanilla `ui/BuffIndicator.java` renders 32 buff icons as 7×7 sprites from `Assets.BUFFS_SMALL`, positioned under the HP bar (`StatusPane.java:129,156`). → Port: **MISSING** — HUD draws canvas-colored **text badges** (`ui/hud.ts:167-177`, `buffColor`, `buffLabel` in `ui/heroView.ts`). Per task note, HUD icons/effects are still canvas-drawn. The labels also diverge: vanilla shows icon-only; port shows text ("Burning", "Poisoned", "Oozed" — vanilla string is "Caustic ooze").

---

## 2. BLOBS / AREA EFFECTS — vanilla `actors/blobs/*.java` (14 classes)

**The port has NO blob system at all.** No `Blob` actor, no cell-volume array, no `evolve()` tick, no blob rendering, no `Blob.seed()`. Everything below is MISSING.

| Blob | Vanilla spec | M1-relevance |
|---|---|---|
| **Fire** (`Fire.java`) | Spread: ignites flamable neighbour of burning cell with volume 4; burns 1 vol/tick; destroys flammable terrain when exhausted (`destr
...[truncated 12987 chars]