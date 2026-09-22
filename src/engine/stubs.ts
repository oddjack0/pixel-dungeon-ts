import { Actor } from '../core/turn.js';
import type { RNG } from '../core/rng.js';
import type { Level } from '../dungeon/level.js';
import {
  type ActionContext,
  type HeroActor,
  type HeroIntent,
  type HeroSaveData,
  type MechanicsHooks,
  type MobActor,
  type MobSaveData,
} from './seams.js';

/**
 * ENGINE PLACEHOLDER mechanics — lets the engine, renderer, and input run
 * end-to-end before the real systems land. NOT gameplay: every formula here
 * is a stub. The mechanics designer replaces this with src/mechanics/*
 * (hero, combat formulas, hunger, buffs, Goo AI) implementing MechanicsHooks.
 */

class StubHero extends Actor implements HeroActor {
  x = 0;
  y = 0;
  hp = 20;
  ht = 20;
  name = 'you';
  sprite = 'hero_warrior';
  sight = 8;

  isAlive(): boolean {
    return this.hp > 0;
  }

  act(): number {
    throw new Error('stub: hero is player-driven');
  }
}

class StubMob extends Actor implements MobActor {
  id: number;
  x = 0;
  y = 0;
  hp = 5;
  ht = 5;
  name = 'rat';
  sprite = 'mob_rat';
  hostile = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  act(): number {
    return 1; // placeholder: mobs idle until content/mechanics land
  }
}

/** STUB damage resolution — the real formula is the mechanics designer's combat.ts. */
function attackMob(target: MobActor, ctx: ActionContext): number {
  const dmg = ctx.rng.intRange(1, 4);
  target.hp -= dmg;
  ctx.log(`You hit the ${target.name} for ${dmg}.`);
  if (target.hp <= 0) {
    ctx.log(`The ${target.name} dies.`);
    ctx.killMob(target);
  }
  return 1;
}

export const stubMechanics: MechanicsHooks = {
  handleHeroIntent(intent: HeroIntent, ctx: ActionContext): number {
    const { level, hero } = ctx;
    switch (intent.kind) {
      case 'move': {
        const nx = hero.x + intent.dx;
        const ny = hero.y + intent.dy;
        const mob = level.mobAt(nx, ny);
        if (mob) {
          const live = ctx.mobs.find((m) => m.x === nx && m.y === ny);
          if (live) return attackMob(live, ctx);
          return 1;
        }
        if (level.isPassable(nx, ny)) {
          hero.x = nx;
          hero.y = ny;
        }
        return 1;
      }
      case 'wait':
        return 1;
      case 'pickup': {
        const item = level.itemAt(hero.x, hero.y);
        if (item) {
          level.items = level.items.filter((it) => it !== item);
          ctx.log(`You pick up ${item.itemId}. (stub: no inventory yet)`);
        } else {
          ctx.log('There is nothing here to pick up.');
        }
        return 1;
      }
      case 'attack': {
        const target = ctx.mobs.find((m) => m.id === intent.targetId);
        if (!target) {
          ctx.log('Nothing to attack.');
          return 1;
        }
        return attackMob(target, ctx);
      }
      case 'useItem':
        ctx.log('(stub: item use not implemented yet)');
        return 1;
      default:
        // UI-proposed intents (equip/drop/throwItem) land here until the real
        // mechanics hooks implement them. Never fall through: an undefined
        // cost would corrupt the scheduler clock.
        ctx.log('(stub: that item action is not implemented yet)');
        return 1;
      case 'descend':
      case 'ascend':
        // Handled by Game itself (level transitions); never reaches here.
        return 1;
    }
  },

  actMob(mob: MobActor, _ctx: ActionContext): number {
    return mob.act();
  },

  spawnHero(_rng: RNG, _level: Level): HeroActor {
    return new StubHero();
  },

  spawnMobs(_rng: RNG, _level: Level): MobActor[] {
    return []; // content/mechanics workers add the Sewers roster
  },

  reviveHero(_rng: RNG, data: HeroSaveData): HeroActor {
    const h = new StubHero();
    h.x = data['x'] as number;
    h.y = data['y'] as number;
    h.hp = data['hp'] as number;
    h.ht = data['ht'] as number;
    h.time = data['time'] as number;
    return h;
  },

  reviveMob(_rng: RNG, data: MobSaveData): MobActor {
    const m = new StubMob(data['id'] as number);
    m.x = data['x'] as number;
    m.y = data['y'] as number;
    m.hp = data['hp'] as number;
    m.ht = data['ht'] as number;
    m.hostile = data['hostile'] as boolean;
    m.time = data['time'] as number;
    return m;
  },

  saveHero(hero: HeroActor): HeroSaveData {
    return { x: hero.x, y: hero.y, hp: hero.hp, ht: hero.ht, time: hero.time };
  },

  saveMob(mob: MobActor): MobSaveData {
    return {
      id: mob.id,
      x: mob.x,
      y: mob.y,
      hp: mob.hp,
      ht: mob.ht,
      hostile: mob.hostile,
      time: mob.time,
    };
  },

  tickActorBuffs(_actor: HeroActor | MobActor, _ctx: ActionContext): void {
    // stub: no buffs
  },
  evolveBlobs(_ctx: ActionContext): void {
    // stub: no blobs
  },

  tickHeroClock(_actor: HeroActor, _ctx: ActionContext, _cost: number): void {
    // stub: no hunger/regen
  },

  applyTransitionHunger(_actor: HeroActor): void {
    // stub: no hunger
  },
};
