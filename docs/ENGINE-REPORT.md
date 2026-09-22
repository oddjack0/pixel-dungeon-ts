# Engine Report — Pixel Dungeon v2 (Milestone 1)

Engine architect's record: architecture decisions, module map, worker seams,
and the save format. Status as of 2026-09-19.

## What was built

A complete, booting engine for the Milestone 1 scope (Warrior, Sewers depths
1–4 + Goo on 5). `bun run typecheck` clean, `bun run build` produces a working
`dist/` (index.html + main.js, 48.5 KB), 100/100 tests pass (`bun test`).

The game runs end-to-end today on **placeholder** dungeon/mechanics/content
(one-room stub level, stub hero that walks/waits/picks up/attacks for 1–4
damage, no mobs). The real Sewers generator, combat formulas, mob roster, Goo
AI, and UI panels plug into the seams below without engine changes.

## Architecture decisions

1. **One seeded RNG, everywhere.** `src/core/rng.ts` (mulberry32). API per
   SPEC: `int(a,b)` [a,b), `float(a,b)`, `intRange(a,b)` [a,b] inclusive,
   `normalIntRange(a,b)` triangular (watabou's NormalIntRange: mean of two
   `[a,b+1)` draws, floored), `pick`, plus `chance`/`shuffle`/`subSeed`/
   `serialize`/`restore`/`hashSeed` for saves, depth sub-streams, and
   `?seed=string`.
2. **Terrain enum copied verbatim, renamed `Tile` → `Terrain`.** SPEC contract
   §1 says "Terrain enum"; the oracle names it `Tile`. Member names, ids
   (WALL=0 … HIGH_GRASS=39), and helpers (`isTrap`, `revealTrapTile`,
   `trapName`, `TRAP_TYPES`, `Region`, `regionForDepth`, `Feeling`) are
   identical; ids will never be renumbered. (Note: the oracle's file shows
   `DOOR_SECRET=4`; verified numerically.)
3. **Shadowcast FOV, not the oracle's line-of-sight.** SPEC asked for
   shadowcast. Recursive 8-octant shadowcasting with Chebyshev radius —
   verified to match the oracle's observable radius behavior; opaque cells are
   themselves marked visible. Same `computeFov(grid, opaque, cx, cy, radius,
   out)` signature, so callers are unaffected.
4. **A* is the oracle's algorithm, rewritten.** 8-dir, Chebyshev heuristic,
   deterministic tie-breaks. Hidden traps are walkable (they're floor cover).
5. **Scheduler is a real priority queue.** SPEC asked for one; the oracle used
   a linear scan. Binary min-heap keyed by `(time, insertion seq)` —
   deterministic ties. `Actor.TICK = 1`; `spend(taker, cost)` sets
   `time = now + cost / speed`.
6. **Game owns everything; UI reads, never duplicates** (SPEC §6). `Game`
   holds `rng, level, hero, mobs, scheduler, log[]`, the tap-to-move path, and
   the pending hero intent. Fixed turn stepping: `pump()` resolves exactly one
   actor turn — hero waits on input, mobs drain in time order.
7. **Mechanics are callbacks, not engine code.** `MechanicsHooks`
   (`handleHeroIntent`, `actMob`, `spawnHero/Mobs`, `save/reviveHero/Mob`) is
   the seam; `Game` intercepts only `descend`/`ascend` (engine-owned level
   transitions). All formulas live in `src/mechanics/` — the engine guesses
   at none.
8. **Renderer codes against the sprite *format*, not the art.** 16×16 char
   grids → `PALETTE`, `.` transparent, `REGION_TINTS` per-region char
   overrides (the art director's table is `Record<region, Record<char, hex>>`,
   applied as direct overrides, not multiplies). Tiles prerendered to 48px
   offscreen canvases (3× of 16px art), cached per region. Missing sprite keys
   render a synthesized magenta marker — never a crash, never touching art
   files. Fog: visible = full, explored = 45% alpha, unseen = black. Camera
   follows the hero, clamped; `screenToTile` inverts it for tap input.
9. **Input produces intents; the game consumes them.** Arrows/WASD/QEZC
   8-dir, Space/`.` wait, `G` pickup, `M`/`I` delegate to UI callbacks,
   `>`/`<` descend/ascend. Tap: adjacent mob = attack, stairs underfoot =
   use, else A* path consumed one step per hero turn (cancelled by manual
   input or a newly-visible hostile — vanilla behavior).
10. **Save is JSON in localStorage, generator-independent.** The level is
    restored tile-for-tile (the generator is *not* re-run); the RNG stream is
    restored bit-exact via `serialize`/`restore`. Hero/mob blobs are
    mechanics-owned (`saveHero`/`reviveHero`, …).

## Module map

| File | Owns |
|---|---|
| `src/core/rng.ts` | Seeded RNG (mulberry32) + `hashSeed` |
| `src/core/grid.ts` | `Terrain` enum + trap/region helpers, `Grid`, `XY` |
| `src/core/fov.ts` | Recursive shadowcast FOV |
| `src/core/path.ts` | A* pathfinding |
| `src/core/turn.ts` | `Actor` (`TICK=1`), `TurnTaker`, heap `Scheduler` |
| `src/dungeon/level.ts` | `Level` model (SPEC §3 shape) + helpers; `LevelGen` seam; `stubLevelGen` placeholder |
| `src/engine/seams.ts` | `HeroIntent`, `HeroActor`/`MobActor`, `ActionContext`, `MechanicsHooks`, save-blob types |
| `src/engine/loop.ts` | `Game`: run state, fixed turn stepping, depth transitions |
| `src/engine/render.ts` | Canvas 2D renderer + camera, `TILE_PX=48` |
| `src/engine/input.ts` | Keyboard + tap-to-move → intents |
| `src/engine/save.ts` | localStorage save/load (`SAVE_KEY='pdv2-save-1'`) |
| `src/engine/stubs.ts` | **PLACEHOLDER** mechanics so the engine boots (replaced by `src/mechanics/`) |
| `src/assets/sprites.ts` | Owned by the art director (landed; engine-tolerant reader) |
| `src/main.ts` | Boot: `?seed=N`, `?continue=1`, Ctrl+S save, rAF loop (≤1 hero action/110ms, mobs drain) |
| `test/` | `rng`, `grid`, `fov`, `path`, `turn`, `loop` (Game + save round-trip) |

## Seams for other workers

- **Dungeon generator** — implement `LevelGen` (`src/dungeon/level.ts`) and
  pass it as `Game`'s `gen` dep; may extend the `Level` model additively.
  `stubLevelGen` is then deleted. Stairs: set `stairsUp`/`stairsDown` cell
  indices; the engine places the hero on `stairsUp`.
- **Mechanics designer** — implement `MechanicsHooks` (`src/engine/seams.ts`).
  `HeroActor`/`MobActor` are structural: `{id?, x, y, hp, ht, name, sprite,
  hostile?, sight?, time, getSpeed(), isAlive(), act()}`. `ActionContext`
  gives `rng, level, hero, mobs, log(), killMob(), syncMobs()`. Note: their
  `Char` model uses `pos` (cell index) while the engine seam uses `x`/`y` —
  their `Hero`/`Mob` classes must bridge the two (or the seam can be
  revisited; engine does not depend on `src/mechanics/char.ts` today).
- **Content designer** — sprite keys are free-form strings; the renderer falls
  back gracefully. Mob/item placement goes through `spawnMobs` and
  `level.items: PlacedItem[]` (`{pos, itemId, sprite}`).
- **UI designer** — read `game.{level, hero, mobs, log, turnCount, gameOver,
  currentPath}`; call `game.queueIntent(...)`. `InputHandler.onToggleMinimap/
  onToggleInventory` are the attach points. Death screen, HUD, inventory,
  minimap, and effects are all UI-owned (engine draws only the dungeon view).

## Save format (`pdv2-save-1`, version 1)

```json
{
  "version": 1, "seed": 4242, "rngState": 987654321,
  "depth": 2, "turnCount": 130, "schedulerNow": 130.0, "gameOver": false,
  "log": ["..."],
  "level": { "w": 24, "h": 18, "depth": 2, "region": "sewers",
             "tiles": [...], "explored": [...],
             "stairsUp": 50, "stairsDown": 400,
             "doors": [...], "traps": [...],
             "items": [{ "pos": 98, "itemId": "dart", "sprite": "dart" }] },
  "hero": { "...mechanics-owned...", "time": 130.0 },
  "mobs": [{ "...mechanics-owned...", "time": 130.5 }]
}
```

- `rngState` is the raw mulberry32 state — restore continues the exact stream.
- `tiles`/`explored` are full arrays (levels are small; ~1–2 KB JSON).
- `hero`/`mobs` blobs: schema owned by the mechanics worker; the engine
  requires `x, y, hp, ht, time` (+ `id`, `hostile` for mobs) to be present.
- `schedulerNow` + per-actor `time` restore exact turn ordering.

## Open issues / ambiguities (not mine to resolve — flagged)

1. **Entity position representation**: the mechanics worker's `Char` uses
   `pos` (cell index); my seam uses `x`/`y`. Their classes must bridge this
   when they implement `MechanicsHooks`. No engine change needed either way,
   but it should be a conscious choice, not an accident.
2. **Buff ticking**: their `char.ts` header says "the engine ticks them".
   Today the engine does not tick buffs — when buffs land, we need to agree
   whether buff ticks are scheduler actors, part of `actMob`/`handleHeroIntent`,
   or an engine `afterAction` hook. Escalate to coordinator.
3. **`package.json` is shared and was edited mid-task** by another worker
   (my `build` script was removed; I re-added it). Worth a coordinator note so
   script edits don't keep clobbering each other.
4. **`src/mechanics/rng.ts` defines its own `MechanicsRng` interface +
   `createRng`** while SPEC §5 says all randomness flows through the engine
   `RNG`. If the mechanics RNG is a *separate* stream, determinism/save
   story needs care (its state must also serialize). Flag for the mechanics
   designer.
5. **Hero `sight`**: engine defaults to 8 via `HeroActor.sight`; mechanics may
   want it derived (e.g. from buffs). Currently read fresh each `afterAction`,
   so a getter works.
6. **Depth transitions reset the clock** (`hero.time = 0`, `scheduler.now =
   0`) instead of preserving actor times across depths like vanilla. Simpler
   and deterministic; revisit if vanilla fidelity demands otherwise.

## Verification

- `bun run typecheck` — clean.
- `bun run build` — `dist/main.js` (48.5 KB) + `dist/index.html`.
- `bun test` — 100 pass, 0 fail (engine suites: rng, grid, fov, path, turn,
  loop/save; plus the mechanics worker's suites, which also pass).
- Not yet done: in-browser playtest of `dist/` (no live-browser access from
  this worker), real Sewers levels (dungeon worker), real combat (mechanics
  worker).
