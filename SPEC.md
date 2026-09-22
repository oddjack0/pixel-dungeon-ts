# Pixel Dungeon v2 — Master Spec (Milestone 1)

Fresh rebuild: HTML5 Canvas + TypeScript, no engine. GPL-3.0, credit Watabou.
Oracle (verified mechanics, reuse logic freely): `~/workspace/pixel-dungeon-ts/`
Mechanics ground truth: `~/workspace/pixel-dungeon-src` (original Java; wins all conflicts)
Reference: `~/workspace/goals/pixel-dungeon-remake-and-remix-foundation/references/mechanics-reference.md`
**Do not touch** `~/workspace/pixel-dungeon-ts/` or `~/workspace/ts-spaces/pixel-dungeon-roguelike/`.
Do not publish anything. Milestone 1 deliverable: verified playable build in `dist/`.

## Milestone 1 scope
Playable Warrior run through the Sewers: depths 1–4 + Goo boss on depth 5.
Systems: seeded dungeon gen, 8-dir movement (keyboard + click/tap pathfind), FOV/explored
memory, turn scheduler, melee + dart combat, EXP/leveling, hunger/regen, pickups
(strength potion, healing potion, darts, ration, short sword upgrades), HUD, inventory
panel, minimap, message log, death screen, save/load run (localStorage). Identification
system, other classes, Prison+ regions are LATER milestones.

## Tech
- `bun` runtime, strict `tsc` typecheck, `bun build` → `dist/` with `index.html`.
- Deterministic: single seeded RNG (mulberry32-style), `?seed=N` in URL.
- Canvas 2D. Logical grid 16×16 tiles per level cell; art logical size 16px, render 3× (48px tiles).
- 1 turn = 1.0 time unit; Actor scheduler = time-ordered priority queue (`Actor.TICK = 1`).

## Directory ownership
- `src/core/` — rng, grid/terrain enum, fov, path (A*) [engine architect]
- `src/engine/` — loop, canvas renderer + camera, input, save/load [engine architect]
- `src/dungeon/` — level model, Sewers generator, rooms, painters, traps [dungeon generator]
- `src/mechanics/` — hero, combat formulas, exp/level, hunger/regen, buffs, Goo AI [mechanics designer]
- `src/content/` — M1 item defs, Sewer mobs (rat, gnoll, crab, swarm, skeleton, thief), Goo [content designer]
- `src/ui/` — HUD, inventory, minimap, log, screens, effects [UI designer]
- `src/assets/` — sprites data (generated) [art director]
- `scripts/build_sprites.py`, `art-src/` — art pipeline [art director]
- `test/` — headless tests [QA tester]

## Shared contracts (binding on all workers)
1. **Terrain enum**: copy verbatim from `~/workspace/pixel-dungeon-ts/src/dungeon/level.ts`
   (Terrain ids + helpers). Do not renumber.
2. **Sprite format**: copy format from `~/workspace/pixel-dungeon-ts/src/ui/sprites.ts`
   (16 strings × 16 chars, char→palette, '.' transparent; `REGION_TINTS` for 5 regions).
   Art director may extend the palette, never change the format.
3. **Level model**: `{ depth, region, width, height, tiles:Uint8Array, explored:Uint8Array,
   stairsUp:number, stairsDown:number, doors, traps, items:[], mobs:[] }` — dungeon generator
   defines exact TS types in `src/dungeon/level.ts`; others import from there.
4. **Entity model**: `Char { id, pos, hp, ht, sprite, ... }`; `Hero` and `Mob` extend it.
   Mechanics designer defines `src/mechanics/char.ts`; combat is pure functions in
   `src/mechanics/combat.ts` operating on these types (port formulas from Java source,
   never from memory).
5. **RNG**: single `RNG` class in `src/core/rng.ts` with `int(a,b)` [a,b), `float(a,b)`,
   `intRange(a,b)` [a,b], `normalIntRange(a,b)`, `pick(arr)`. All randomness flows through it.
6. **Game state**: engine architect defines `Game` in `src/engine/loop.ts` holding
   `level, hero, scheduler, rng, log[]`; UI reads from it, never duplicates state.

## Rules
- Mechanics from Java source only. Ambiguous source or fidelity-vs-scope tradeoff →
  STOP and escalate to the coordinator (do not guess).
- Art never warps mechanics. All art original; never copy any game's pixels.
- Every worker: `bun run typecheck` clean, tests for your module in `test/`, report in `docs/`.
- Nothing merges to milestone without supervisor sign-off (coordinator enforces).
