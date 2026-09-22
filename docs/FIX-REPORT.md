# Fix Report — Code Review Items (2026-09-19)

**Scope:** `~/workspace/pixel-dungeon-v2/`. All fixes verified against the Java
ground truth (`~/workspace/pixel-dungeon-src`); Java won every conflict.
**Do not touch** list respected: `src/assets/`, `scripts/`, `art-src/`,
`test/sprites.test.ts` untouched (art-fix agent's territory).

**Verification:** `bun run typecheck` clean · `bun test` **256 pass, 0 fail**
(239 pre-existing + 17 new in `test/fix-regressions.test.ts`) · `bun run build`
→ `dist/main.js` 210.65 KB + `index.html` rebuilt.

## MUST FIX

### 1. Search mechanic (was: ~10% of runs uncompletable)
- **New `HeroIntent`: `{ kind: 'search' }`** (`src/engine/seams.ts`).
- **Key binding:** `F` in `src/engine/input.ts` (WASD are taken by movement;
  vanilla has no keyboard search — this is a port affordance, documented).
- **Intentional search** (`searchIntentional`, `src/content/actions.ts`):
  reveals every secret door in a *visible* cell within chebyshev radius 1 —
  no roll, per the `intentional ||` branch (Hero.java:1336); costs
  `TIME_TO_SEARCH = 2` (Hero.java:134). Vanilla's "2, or 4 on an unlucky roll
  when something was found" simplified to flat 2.
- **Passive search** (`passiveSearch`, called from `moveHero` after every
  successful step, mirroring `Hero.onMotionComplete → search(false)`,
  Hero.java:1241-1246): each secret door within radius 1 revealed with
  probability `hero.awareness` (0.1 for the warrior, Hero.java:175; new
  `ContentHero.awareness` field).
- Wired to the existing `Level.revealSecretDoor()`.
- **Verification:** regression tests — intentional search reveals an adjacent
  door at exactly 2 turns of clock cost; radius-2 doors untouched; forced
  (awareness = 1.0) passive search reveals on move.
- **Known gaps (documented, not fixed):** hidden *traps* are not discovered by
  search yet (doors only); vanilla's `updateAwareness()` level-up scaling
  (Hero.java:1064-1069) not ported — awareness stays flat 0.1.

### 2. Non-deterministic generation (`specialsRotation`)
- **Fix:** `Game` constructor now calls `resetSpecials(this.rng)` before the
  depth-1 generation (`src/engine/loop.ts`), mirroring vanilla's once-per-run
  `Room.shuffleTypes`. The batch helper `generateRun` already did this; the
  live engine path (`sewersLevelGen`/`contentLevelGen`) did not, so each run
  inherited the previous run's mutated module-level rotation.
- **Verification:** regression tests — three `new Game(sameSeed)` produce
  byte-identical tiles/stairs/doors/traps/items **and** identical RNG state;
  a second run no longer diverges from the first. (These tests fail on the
  old code — verified by temporary revert.)
- `loadGame` is unaffected: it boots `Game` with a fixed level gen, then
  overwrites the RNG from the save blob.

### 3. Hero acts first on a new floor
- **Fix:** `changeDepth()` (`src/engine/loop.ts`) now registers the hero in
  the scheduler **before** the mobs (vanilla `Actor.init()`:
  `addDelayed(Dungeon.hero, -Float.MIN_VALUE)` then mobs — hero registered
  first). Simultaneous times break hero-first via the insertion-order
  tie-break. The descend/ascend intent no longer re-`spend()`s after a
  transition — `changeDepth` owns the fresh clock (vanilla's scene-switch
  ends the turn; `Actor.init()` rebuilds the clock).
- **Verification:** regression test — after descending onto a floor with 6
  mobs, `scheduler.peek() === hero`. (Fails on old code — verified.)

### 4. Keyboard bump-attack
- **Fix:** `moveHero()` (`src/content/actions.ts`) checks `ctx.mobs` for a
  live mob on the target cell *before* moving and strikes it (vanilla
  `Hero.handle` behavior), using the same accuracy/damage path as the
  `attack` intent. The hero no longer stacks onto the mob's cell.
- **Verification:** regression test — moving into a rat attacks (hit/miss
  logged, rat woken) and the hero stays put. (Tap-to-move pathing already
  converted bumps to attacks in `nextHeroIntent`; unchanged.)

### 5. Death by mob ends the run immediately
- **Fix:** `pump()`'s mob branch now calls `checkHeroDeath()` after `actMob`
  and returns `'over'` when the run ended (`src/engine/loop.ts`).
- **Verification:** regression test — a mob reducing the hero to 0 HP sets
  `gameOver` and the same `pump()` returns `'over'` with "You died..." logged.
  (Fails on old code — verified.)

## SHOULD FIX

### 6. Goo jump landing
- **Fix:** `jumpDest()` (`src/content/goo-boss.ts`) now lands on
  `hero − sign(hero − goo)` — the cell **before** the hero along the trace
  (Java: `Ballistica.trace[Ballistica.distance − 2]`, Goo.java:117) — instead
  of beyond the hero. The landing cell is validated (in-bounds, walkable via
  `isPassable`, unoccupied); Goo stays put and still strikes if invalid.
- **Verification:** regression tests — pumped jump from (5,5) vs hero (5,7)
  lands on (5,6); occupied landing cell → Goo doesn't move.

### 7. Depth transitions now tick buffs AND hunger/regen
- **Fix:** `pump()` (`src/engine/loop.ts`) calls `tickActorBuffs` on **every**
  hero turn (moved ahead of the descend/ascend branch), and a new
  `MechanicsHooks.tickHeroClock(actor, ctx, cost)` seam — engine owns the
  call site, mechanics owns the logic (same pattern as `tickActorBuffs`;
  `src/engine/seams.ts`, `src/content/hooks.ts`, `src/engine/stubs.ts`).
  The internal `tickHeroClock` calls were removed from `handleHeroIntent`
  (identical ordering: end of hero turn, living hero only). `tryDescend` /
  `tryAscend` now return whether a transition happened so the clock isn't
  double-charged.
- **Verification:** regression tests — descending with `hungerClock = 9`,
  `hungerLevel = 259` advances to 269; a 12-turn poison ticks pre-transition.

### 8. `GOO_DEF.maxLvl` 10 → 30
- Goo never overrides `maxLvl`; the Mob default 30 (Mob.java:69) applies.
  Now `GOO_MAX_LVL = 30` in `src/mechanics/goo.ts`, referenced by `GOO_DEF`.
- **Verification:** `expForKill('goo', 30) === 10`, `expForKill('goo', 31) === 0`.

### 9. Drop costs 0.5 turns
- `dropSlot()` (`src/content/actions.ts`) returns `0.5` (both branches);
  the comment's wrong line citation fixed: `TIME_TO_DROP = 0.5`
  (Item.java:70, not :43).
- **Verification:** regression test asserts `dropSlot(...) === 0.5`.

### 10. Scheduler tie-break docstring
- `src/core/turn.ts` docstring corrected: ties break by **re-insertion**
  order (each `add()` stamps a fresh sequence number), not first-insertion
  order. **Recorded policy:** sustained ties alternate round-robin in re-add
  order; the hero, registered first on a fresh floor, wins the first tie —
  equivalent to vanilla's `HashSet` order in sustained ties. No behavior
  change.
- **Verification:** new test asserts the `a, b, a, b` alternation; existing
  turn tests (comment touched up) still pass.

### 11. Goo resistances
- Java puts ToxicGas, Death, **and** ScrollOfPsionicBlast in `RESISTANCES`
  (halve damage — Goo.java:228-233), not immunities. `GOO_DEF` is now
  `immunities: []`, `resistances: [...GOO_RESISTANCES]`; the previously dead,
  misnamed `GOO_RESISTANCES` constant (`toxicGas`/`deathGlyph`/`psionicBlast`,
  never referenced) was renamed to the codebase tag convention
  (`toxic_gas`/`death`/`psionic_blast`) and is now actually used. M1 has no
  such effects yet — tags are forward-looking.
- **Verification:** regression test on `GOO_DEF.resistances`/`immunities`.

### 12. Single sources of truth
- **Goo stats:** `GOO_DEF` (`src/content/goo-boss.ts`) now references
  `GOO_HT / GOO_ATTACK / GOO_DEFENSE / GOO_DR / GOO_EXP / GOO_MAX_LVL /
  GOO_DMG_MIN / GOO_DMG_MAX / GOO_RESISTANCES` from `src/mechanics/goo.ts`
  (new: `GOO_MAX_LVL`, `GOO_DMG_MIN/MAX`, `GOO_DMG_PUMPED_MIN/MAX`;
  `gooDamageRoll` uses them).
- **EXP/maxLvl:** `MOB_EXP.goo` (`src/mechanics/exp.ts`) uses
  `GOO_EXP`/`GOO_MAX_LVL`; all six sewer-mob defs in `src/content/mobs.ts`
  now read `exp`/`maxLvl` from `MOB_EXP` (canonical Java citations live in
  `exp.ts`). `killMob` already used `expForKill` (table) for EXP and
  `def.maxLvl` for the loot gate — both now agree by construction.
- **Hero formulas:** the odd `createWarrior()` coupling in
  `createStarterHero` (used only for the dart count) is gone — literal `8`
  with its `HeroClass.java:121` citation. `src/content/items.ts` is declared
  canonical for gear stats; `src/mechanics/hero.ts` (`SHORT_SWORD`, `DART`,
  `CLOTH_ARMOR`) is its layering-required mirror for formula defaults
  (mechanics may not import content) — a new test asserts deep equality so
  they cannot drift silently again.
- **Verification:** parity test + full suite green.

## Files changed
`src/engine/loop.ts`, `src/engine/seams.ts`, `src/engine/input.ts`,
`src/engine/stubs.ts`, `src/content/actions.ts`, `src/content/hooks.ts`,
`src/content/hero.ts`, `src/content/mobs.ts`, `src/content/goo-boss.ts`,
`src/mechanics/goo.ts`, `src/mechanics/exp.ts`, `src/core/turn.ts`,
`test/fix-regressions.test.ts` (new, 17 tests), `test/turn.test.ts`
(comment), `dist/` (rebuilt).

## Open follow-ups (not in scope)
- Hidden-trap discovery via search (doors only for now).
- `updateAwareness()` level-up scaling (flat 0.1 for M1).
- Vanilla's extra hunger cost on descend (`STARVING/10` in `actDescend`) —
  transitions now tick the normal clock; the extra descend hunger cost was
  not ported.
- Goo balance (QA report: 0% bot win rate) — untouched, still open.
