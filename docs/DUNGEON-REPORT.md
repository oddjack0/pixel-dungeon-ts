# Dungeon Report — Milestone 1: Sewers (depths 1–4) + Goo boss (depth 5)

**Status:** complete. `bun run typecheck` clean, `bun test` 130/130 pass
(24 dungeon-specific tests in `test/dungeon.test.ts`).
**License:** GPL-3.0, derived from watabou/pixel-dungeon with credit to Watabou.
**Ground truth:** `~/workspace/pixel-dungeon-src/src/com/watabou/pixeldungeon/levels/`
wins every conflict; the oracle at `~/workspace/pixel-dungeon-ts/src/dungeon/`
was read-only reference (never modified).

## What was built

| File | Contents |
|---|---|
| `src/dungeon/rooms.ts` | Inclusive-bounds `Room`/`Rect`, BSP splitting, neighbor detection, distance maps, path building/pricing, regular + boss connection planning, special-room rotation, weak-floor→pit chaining, shared doors with monotonic upgrades, standard-room joining |
| `src/dungeon/painters.ts` | `PainterCtx`, all room painters (vanilla `StandardPainter` variants + 14 special rooms + entrance/exit/boss-exit), `paintDoorTiles`, `paintWaterGrass`, `placeTraps`, `decorateSewers`/`decorateBoss`/`placeSign`, `Patch.generate` |
| `src/dungeon/generator.ts` | `generateLevel(rng, depth, run)`, `generateRun(rng)` (depths 1–5), `RunState`, `sewersLevelGen` (engine `LevelGen` SEAM adapter) |
| `src/dungeon/level.ts` | Extended only: `feeling`, `bossLevel`, `sealed`, `secretDoors` fields; content-facing `ItemSpawn`/`MobSpawn`/`HeapKind`; `MobKind` gained `'ghost'` (sad-ghost quest mob has no other slot) |
| `test/dungeon.test.ts` | Determinism, stairs, connectivity, Goo arena, trap/door ranges, mob placement, markers |

## Source fidelity (Java file → port)

- `levels/Level.java#create()` — quest-item queue → feeling roll → build retry
  loop → `paint()`/`paintWater()`/`paintGrass()` → `placeTraps()` →
  `decorate()` → `createMobs()` → `createItems()`. Same order in `generateLevel`.
- `levels/RegularLevel.java#build()` — entrance/exit ≥4×4, 11 outer attempts
  (`if (retry++ > 10)` runs the body 11 times), graph distance ≥
  ⌊√rooms⌋, both paths carved, random links to 50–70% connected.
- `levels/SewerBossLevel.java#build()` — entrance ≥4×4 / exit ≥6×6, exit not on
  the top map edge, 11 inner + 11 outer attempts; **only the second (priced)
  path is carved**; NULL rooms on the path become TUNNEL; the approach room
  directly above the arena is rejected (`roomExit.top == room.bottom`);
  the Rat King attaches to an unconnected neighbor on the arena's **left,
  right, or bottom** — never the top.
- `levels/painters/BossExitPainter.java` — arena filled wall→floor, locked
  exit at top-center wall (`room.l + (room.r - room.l) / 2`).
- `levels/SewerBossLevel.java#decorate()` — top interior wall row → WALL_DECO
  with WATER below, except the exit column (stays clear, FLOOR below).
- `levels/SewerLevel.java#decorate()` — wall-deco strips above water,
  probability-scaled empty-deco, entrance-room sign.
- `levels/painters/StandardPainter.java` — all six variants, **including the
  Java switch fall-through**: case 0 with GRASS feeling falls through to the
  burned-room branch; case 4 with WATER feeling falls through to the fissure
  branch. (An earlier draft broke out of both; fixed against source.)
- `levels/Room.java` — `SPECIALS` order, `shuffleTypes` Fisher-Yates, `useType`
  rotation; inclusive bounds (`width() = right - left`); `Door.set`
  monotonic upgrades.
- `levels/RegularLevel.java#placeTraps()` — depth 1: 0 attempts; else
  `Random.Int(1, rooms.size() + depth)` attempts, each placing only on EMPTY.
- `levels/RegularLevel.java#createMobs()` — `2 + depth % 5 + Random.Int(3)`
  mobs via `randomRespawnCell` (standard rooms, not visible from entrance).
- `levels/Level.java#createItems()` — 3 items, +1 while `Random.Float() < 0.4`;
  heap roll `Random.Int(20)`: 0 → skeleton, 1–4 → chest, 5 → mimic (depth > 1)
  else chest, else plain heap. Upgrade scroll re-rolled off fire traps.
- `actors/mobs/Goo.java` via `SewerBossLevel#Bestiary` — Goo is the sole
  depth-5 mob, spawned in `roomExit`.
- Door secrecy: depth 1 never secret; depths 2–5 secret on
  `Random.Int(12 - depth) == 0`; joined STANDARD↔STANDARD pairs carve open
  passages instead of doors (`Room.joinRooms`).
- `Terrain.java` flags: `LOCKED_EXIT` is SOLID (not walkable) — the hero
  stands adjacent; the tile unlocks when Goo dies. The generator and tests
  model this exactly.

## Determinism adaptations (deliberate, documented)

1. **Seeded RNG everywhere.** Vanilla uses unseeded `Math.random()` in a few
   spots (e.g. the BSP split stop expression); this port routes every random
   choice through the shared seeded `RNG`, so the same seed always yields the
   same level. Verified by test: two runs from one seed are byte-identical
   (tiles, doors, traps, items, mobs, markers).
2. **Deterministic iteration order.** Vanilla iterates `HashSet`/`HashMap`
   (rooms, connections) in nondeterministic order. This port uses fixed
   y/x room order and insertion-ordered lists. Same seed ⇒ same result.
3. **`Patch.generate` borders.** Vanilla reuses static arrays, so border cells
   leak state from previous calls. This port uses fresh arrays (borders stay
   false) — required for per-seed reproducibility.
4. **One door paint pass.** Vanilla `paintDoors` paints each door twice (once
   per room, re-rolling secret/barricade each time). This port paints each
   unique shared door once, keeping the same per-door probability law.
5. **Bounded retries.** Vanilla's build loop and `randomRespawnCell` /
   `randomDropCell` spin unboundedly. This port caps the build loop at 200
   attempts, respawn search at 10 tries × 50 outer attempts per mob, and drop
   search at 1000 tries. A mob that cannot place is skipped rather than
   hanging generation (vanilla would spin forever on a pathological map).

## Simplifications and open seams

- **Decorative terrain has no shared IDs.** `EMPTY_DECO`, `WALL_DECO`, `SIGN`,
  `EMPTY_WELL` don't exist in the shared `Terrain` contract, so tiles stay
  `WALL`/`FLOOR` and positions are recorded in `GenResult.markers`
  (`wallDeco`, `emptyDeco`, `signs`, `dryWells`, plus `alchemy` and `wells`
  for special rooms). The renderer draws them from markers.
- **Bones skipped.** `SewerBossLevel.createItems` is `Bones.get()` only; there
  is no cross-run bone state in M1, so depth 5 ships no normal items (only
  Rat King room chests, which vanilla also drops there).
- **Spawn lists ride alongside.** `Level.items`/`Level.mobs` (engine
  `PlacedItem`/`PlacedMob`) stay empty; the generator returns `ItemSpawn[]` /
  `MobSpawn[]` in `GenResult` for the content designer to resolve
  (`Bestiary.mob(depth)` choice, prize tables, ghost quest logic).
- **Tags carry intent.** `ItemSpawn.tag` holds vanilla intent, e.g.
  `'iron-key'`, `'quest-scroll-of-upgrade'`, `'dew-vial'`, `'pool-prize'`;
  gold amounts are rolled at paint time (vanilla does this) and encoded as
  `'gold:<n>'`.
- **Mob visibility check.** Vanilla rejects spawn cells with
  `Dungeon.visible[cell]`; this port recomputes FOV from the entrance with
  radius 8 and a sight-blocking predicate (walls, closed/secret/locked doors,
  barricades, bookshelves, statues).
- **`sewersLevelGen`** adapts `generateLevel` to the engine's `LevelGen`
  seam; cross-depth state (weak-floor chain, ghost once/run, dew vial
  once/run) only stays consistent via `generateRun`.
- **Trap accounting.** `placeTraps` returns `{attempts, placed}`; exposed on
  `GenResult` as `trapAttempts`/`trapsPlaced` and asserted in tests
  (depth 1: 0; else 1 ≤ attempts < rooms + depth; placed ≤ attempts).
- **Connectivity definition.** Depths 1–4: entrance reaches the exit tile
  (doors count as traversable — keys are guaranteed). Depth 5: the locked
  exit is solid per vanilla flags; the floor cell below it is reachable.

## Verification

- `bun run typecheck` — clean.
- `bun test` — 130/130 pass, including 24 dungeon tests covering:
  determinism (identical tiles + metadata; different seeds differ), both
  stairs on depths 1–5, EXIT vs EXIT_LOCKED tiles, entrance→exit reachability,
  boss level flags, Goo as sole boss mob inside the arena, arena ≥6×6 with
  top-center exit, arena water decoration, rat-king placement constraints,
  quest-item tags per depth, trap attempt ranges, secret-door counts matching
  secret tiles, no secret doors on depth 1, door cells holding door tiles,
  mobs in standard rooms away from the entrance, mob count ranges, entrance
  signs, and marker/tile consistency.

## Suggested follow-ups (not in M1 scope)

- Renderer: draw `markers` (wall/empty deco, signs, alchemy pots, wells).
- Content: resolve `ItemSpawn`/`MobSpawn` (prize tables, `Bestiary.mob(depth)`,
  ghost quest, Goo boss AI).
- Mechanics: locked-exit unlock on Goo death; iron-key/locked-door flow;
  trap triggering from `level.traps`.
