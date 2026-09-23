/**
 * Tengu, the Prison boss (depth 10).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/Tengu.java.
 * Java wins every conflict. Numbers live in src/mechanics/tengu.ts.
 *
 * Portrait of the fight (Tengu.java):
 * - JUMP_DELAY = 5; timeToJump starts at 5 (Tengu.java:49-58).
 * - getCloser: when the target cell is in the HERO's FOV, Tengu jumps
 *   instead of walking (Tengu.java:108-116).
 * - doAttack: every attack decrements timeToJump; when it reaches 0 and
 *   the enemy is adjacent, Tengu jumps instead of striking (Tengu.java:123-132).
 * - jump(): resets timeToJump; converts up to 4 inactive hero-visible
 *   passable traps into discovered POISON_TRAPs; relocates to a random
 *   hero-visible passable cell that holds no char and is not adjacent to
 *   the enemy; spends 1/speed() (Tengu.java:134-168).
 * - notice(): yells "Gotcha, <hero class>!" (Tengu.java:170-174).
 * - die(): conditional Tome of Mastery (Tengu.java:78-97), boss-slain
 *   bookkeeping (Tengu.java:99), always drops the skeleton key
 *   (Tengu.java:100), yells "Free at last..." (Tengu.java:105).
 * - Resistances: ToxicGas, Poison, Death, ScrollOfPsionicBlast — halved,
 *   not negated (Tengu.java:183-194).
 */
import { Terrain } from '../core/grid.js';
import type { Level } from '../dungeon/level.js';
import type { ActionContext } from '../engine/seams.js';
import {
  TENGU_ATTACK,
  TENGU_DEFENSE,
  TENGU_DMG_MAX,
  TENGU_DMG_MIN,
  TENGU_DR,
  TENGU_EXP,
  TENGU_HT,
  TENGU_JUMP_DELAY,
  TENGU_MAX_LVL,
  TENGU_RESISTANCES,
  TENGU_TRAPS_PER_JUMP,
  tenguShouldJump,
} from '../mechanics/tengu.js';
import {
  charAtPos,
  chebyshevPos,
  ContentMob,
  dropItemAt,
  heroOf,
  rangedCanAttack,
  registerTengu,
  type MobDef,
} from './mobs.js';
import { ITEMS } from './items.js';
import type { ContentHero } from './hero.js';

/**
 * Tengu.java:51-75 — HP/HT 120, def 20, atk 20, NormalIntRange(8,15),
 * dr 5, EXP 20, maxLvl default 30 (Mob.java:69 — not overridden).
 * All numbers single-sourced from src/mechanics/tengu.ts.
 */
export const TENGU_DEF: MobDef = {
  id: 'tengu',
  name: 'Tengu',
  sprite: 'mob_tengu',
  hp: TENGU_HT,
  atk: TENGU_ATTACK,
  def: TENGU_DEFENSE,
  dmgMin: TENGU_DMG_MIN,
  dmgMax: TENGU_DMG_MAX,
  triangular: true,
  dr: TENGU_DR,
  exp: TENGU_EXP,
  maxLvl: TENGU_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [],
  resistances: [...TENGU_RESISTANCES],
};

export class TenguMob extends ContentMob {
  timeToJump = TENGU_JUMP_DELAY; // Tengu.timeToJump (Tengu.java:50)

  constructor(id: number, pos: number, w: number) {
    super(id, TENGU_DEF, pos, w);
  }

  /** Tengu.canAttack: Ballistica (Tengu.java:118-121). */
  override canAttack(ctx: ActionContext, targetPos: number): boolean {
    return rangedCanAttack(ctx, this, targetPos);
  }

  /**
   * Tengu.getCloser (Tengu.java:108-116): when the hero is in FOV
   * (Level.fieldOfView is the hero's), jump instead of walking.
   */
  override getCloser(ctx: ActionContext, target: number): boolean {
    const hero = heroOf(ctx);
    if (this.enemySeen && target === hero.pos) {
      this.jump(ctx, hero.pos);
      return true;
    }
    return super.getCloser(ctx, target);
  }

  /**
   * Tengu.doAttack (Tengu.java:123-132): decrement the jump timer on every
   * attack; jump instead of striking when it expires with the enemy
   * adjacent. The jump branch spends 1/speed() (from jump()), NOT an
   * additional attackDelay (Tengu.java:167).
   */
  override doAttack(ctx: ActionContext, enemy: ContentHero | ContentMob): number {
    const adjacent = chebyshevPos(this.pos, enemy.pos, this.w) <= 1;
    const { jump, nextTimeToJump } = tenguShouldJump(this.timeToJump, adjacent);
    this.timeToJump = nextTimeToJump;
    if (jump) {
      this.jump(ctx, enemy.pos);
      return 1; // spend(1/speed()) -> real 1/speed (moveCost convention)
    }
    return super.doAttack(ctx, enemy);
  }

  /**
   * Tengu.jump (Tengu.java:134-168). The vanilla trap loop draws random
   * cells until hero-FOV-visible AND passable; the port caps the retries
   * per iteration (vanilla would spin forever on a level with no such
   * cell — unreachable in practice since the hero stands on one).
   */
  private jump(ctx: ActionContext, enemyPos: number): void {
    const rng = ctx.rng;
    const level = ctx.level;
    const size = level.w * level.h;
    this.timeToJump = TENGU_JUMP_DELAY;

    // Arm traps: up to 4 draws of a hero-visible passable cell; an
    // INACTIVE_TRAP there becomes a discovered POISON_TRAP (Tengu.java:137-148).
    for (let i = 0; i < TENGU_TRAPS_PER_JUMP; i++) {
      const trapPos = this.drawVisiblePassable(rng, level, size, 50);
      if (trapPos !== -1 && level.getAt(trapPos) === Terrain.TRAP_INACTIVE) {
        level.set(trapPos % level.w, Math.floor(trapPos / level.w), Terrain.TRAP_POISON);
        // Level.set + GameScene.updateMap + ScrollOfMagicMapping.discover
        // (Tengu.java:144-146): the revealed poison trap is now live.
      }
    }

    // Relocate: hero-visible, passable, unoccupied, not adjacent to the
    // enemy (Tengu.java:150-157).
    let newPos = -1;
    for (let tries = 0; tries < 200 && newPos === -1; tries++) {
      const cand = rng.int(0, size);
      if (!level.visible[cand]) continue;
      const cx = cand % level.w;
      const cy = Math.floor(cand / level.w);
      if (!level.isPassable(cx, cy)) continue;
      if (chebyshevPos(cand, enemyPos, level.w) <= 1) continue;
      if (charAtPos(ctx, cand, this)) continue; // Actor.findChar(cand) != null
      newPos = cand;
    }
    if (newPos !== -1) {
      this.pos = newPos;
      // sprite.move + CellEmitter wool burst + SND_PUFF (Tengu.java:159-163):
      // visuals — the renderer owns them.
    }
  }

  /** Bounded draw of a hero-FOV-visible, passable cell (-1 when none found). */
  private drawVisiblePassable(
    rng: { int(min: number, max: number): number },
    level: Level,
    size: number,
    tries: number,
  ): number {
    for (let t = 0; t < tries; t++) {
      const cand = rng.int(0, size);
      if (!level.visible[cand]) continue;
      if (!level.isPassable(cand % level.w, Math.floor(cand / level.w))) continue;
      return cand;
    }
    return -1;
  }

  /** Tengu.notice (Tengu.java:170-174). */
  protected override onNotice(_ctx: ActionContext): void {
    // yell("Gotcha, " + Dungeon.hero.heroClass.title() + "!") — the port's
    // M1 hero has no class system yet; the only hero is the warrior.
    _ctx.log('Gotcha, warrior!');
  }

  /**
   * Tengu.die (Tengu.java:78-105), via the onDeath hook (runs after
   * EXP/loot in killMob).
   */
  override onDeath(ctx: ActionContext): void {
    // Tome of Mastery (Tengu.java:78-97): dropped unless the hero's mastery
    // badge is unlocked AND their subclass is NONE. Badges/subclasses land
    // in Stage 6, so the condition cannot be evaluated yet — the common
    // case (no badge) drops the tome. The vanilla item ID is used; the
    // drop activates automatically once the item worker adds it to the
    // catalog (no substitute IDs — exact-copy rule).
    if (ITEMS['tome_of_mastery']) {
      dropItemAt(ctx, this.pos, 'tome_of_mastery');
    }
    // GameScene.bossSlain() (Tengu.java:99) shows the BOSS_SLAIN banner —
    // renderer territory. Badges.validateBossSlain() is Stage 6.
    // PrisonBossLevel has no arena seal (unlike SewerBossLevel), so nothing
    // to unseal.
    dropItemAt(ctx, this.pos, 'skeleton_key'); // Tengu.java:100
    ctx.log('Free at last...'); // Tengu.yell, Tengu.java:105
  }
}

// Register the Tengu constructor with mobs.ts (avoids an import cycle).
registerTengu(TenguMob);
