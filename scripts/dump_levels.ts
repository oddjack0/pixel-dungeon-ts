/** Dump generated levels to /tmp/levels.json for the QA scene renderer. */
import { generateLevel, newRunState } from '../src/dungeon/generator.js';
import { RNG } from '../src/core/rng.js';

const MOB_SPRITE: Record<string, string> = {
  mob: 'mob_rat', boss: 'mob_goo', ratking: 'mob_rat', statue: 'mob_skeleton',
  piranha: 'mob_crab', ghost: 'mob_thief',
};

function dump(depth: number, seed: number) {
  const rng = new RNG(seed);
  const run = newRunState();
  const res = generateLevel(rng, depth, run);
  const lvl = res.level;
  return {
    w: lvl.w, h: lvl.h,
    tiles: Array.from(lvl.tiles),
    items: res.items.map((it) => ({ pos: it.pos, sprite: 'potion_red' })),
    mobs: res.mobs.map((m) => ({
      x: m.pos % lvl.w, y: Math.floor(m.pos / lvl.w),
      sprite: MOB_SPRITE[m.kind] ?? 'mob_rat',
    })),
    stairsUp: lvl.stairsUp, stairsDown: lvl.stairsDown,
  };
}

const levels = [dump(1, 1234), dump(5, 777)];
await Bun.write('/tmp/levels.json', levels.map((l) => JSON.stringify(l)).join('\n'));
console.log('wrote /tmp/levels.json');
