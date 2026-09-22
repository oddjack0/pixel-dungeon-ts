#!/usr/bin/env bun
/**
 * QA helper: dump real generated levels (fixed seeds) as JSON for the
 * Python scene renderer (scripts/qa_original_scenes.py).
 * Usage: bun scripts/qa_dump_levels.ts > /tmp/levels.json
 */
import { RNG } from '../src/core/rng.js';
import { generateLevel, newRunState } from '../src/dungeon/generator.js';
import '../src/content/goo-boss.js'; // side-effect: registers the Goo ctor
import { resolveMobSpawns, buildMobs, resolveItemSpawns } from '../src/content/spawns.js';

const JOBS: Array<[number, number]> = [
  [1, 1234],
  [5, 777],
];

for (const [depth, seed] of JOBS) {
  const run = newRunState();
  const result = generateLevel(new RNG(seed), depth, run);
  const level = result.level;
  const mobs = buildMobs(
    resolveMobSpawns(new RNG(seed ^ 0x9e37), depth, result.mobs),
    level.w,
  );
  const items = resolveItemSpawns(new RNG(seed ^ 0x51f3), depth, result.items);
  console.log(
    JSON.stringify({
      depth,
      seed,
      w: level.w,
      h: level.h,
      tiles: Array.from(level.tiles),
      stairsUp: (level as unknown as { stairsUp: number }).stairsUp,
      mobs: mobs.map((m) => ({ x: m.x, y: m.y, sprite: m.sprite })),
      items: items.map((i) => ({ pos: i.pos, sprite: i.sprite })),
    }),
  );
}
