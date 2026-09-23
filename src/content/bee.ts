/**
 * Honeypot bee (actors/mobs/npcs/Bee.java, GPL-3.0): the "golden bee"
 * ally spawned when a honeypot shatters (Honeypot.shatter,
 * Honeypot.java:84-113). Java wins every conflict.
 *
 * Faithful behaviors:
 * - Bee.spawn(level) (Bee.java:90-99): HT = (3 + level) * 5,
 *   defenseSkill = 9 + level, state = WANDERING (init block, Bee.java:77).
 * - Bee.attackSkill = defenseSkill (Bee.java:127-129).
 * - Bee.damageRoll = Random.NormalIntRange(HT / 10, HT / 4) (Bee.java:123).
 * - Bee extends NPC: damage is a no-op (NPC.damage, NPC.java:33-37) — the
 *   bee cannot be hurt by ordinary attacks; it dies only through its
 *   per-action HP decay.
 * - Bee.act (Bee.java:149-156): loses 1 HP per action; at 0 it dies
 *   instead of acting — its lifespan is measured in turns.
 * - Bee.chooseEnemy (Bee.java:104-121): keeps the current enemy while it
 *   lives; otherwise a random hostile mob in the HERO's field of view
 *   (Level.fieldOfView). The bee never targets the hero.
 * - Bee.Wandering (Bee.java:174-203): on seeing an enemy it notices and
 *   hunts IMMEDIATELY (no Mob.Wandering justAlerted roll); otherwise it
 *   follows the hero (getCloser(hero.pos), else spend(TICK)).
 * - Bee.attackProc (Bee.java:157-161): a mob stung by the bee is
 *   aggroed onto the bee (mob.aggro(this)).
 * - Bee is immune to poison (Bee.java:58: IMMUNITIES = Poison.class).
 * - Bee.interact (Bee.java:163-173): swaps positions with the hero and
 *   costs the hero 1/speed() with hero.busy().
 * - Sprite: BeeSprite (BeeSprite.java:36-39) -> the port's `mob_bee`
 *   (src/assets/original_sprites.ts), extracted from bee.png.
 *
 * Known infidelity: the port's talk intent costs 0 turns, so the
 * interact's 1/speed() hero cost is not representable on this path — the
 * position swap itself is faithful.
 */
import type { ActionContext } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import { setSummonBee } from './honeypot.js';
import {
  ContentMob,
  heroOf,
  killMob,
  nextMobId,
  registerBee,
  type MobDef,
} from './mobs.js';
import type { ContentHero } from './hero.js';

/**
 * Bee stats at spawn depth (Bee.spawn, Bee.java:90-99):
 * HT = (3 + level) * 5, attackSkill = defenseSkill = 9 + level.
 */
export function beeDef(depth: number): MobDef {
  const ht = (3 + depth) * 5;
  const skill = 9 + depth;
  return {
    id: 'bee',
    name: 'golden bee', // Bee.java:36: TXT_NAME
    sprite: 'mob_bee', // BeeSprite.java:36-39
    hp: ht,
    atk: skill, // Bee.attackSkill = defenseSkill (Bee.java:127-129)
    def: skill, // Bee.defenseSkill = 9 + level (Bee.java:96-98)
    // Damage is rolled live from HT (Bee.damageRoll, Bee.java:123-125);
    // the def die is filled for catalog completeness.
    dmgMin: Math.floor(ht / 10),
    dmgMax: Math.floor(ht / 4),
    triangular: true,
    dr: 0,
    exp: 0, // NPC (Bee extends NPC; EXP field default)
    maxLvl: 30,
    speed: 1, // Mob.speed default (Bee does not override it)
    viewDistance: 4, // Bee.java:66
    flying: true, // Bee.java:62
    ability: null,
    attackDelay: 1, // Mob.attackDelay default
    immunities: ['poison'], // Bee.java:58: IMMUNITIES = Poison.class
    resistances: [],
  };
}

export class BeeMob extends ContentMob {
  constructor(id: number, pos: number, w: number, depth: number) {
    super(id, beeDef(depth), pos, w);
    // Bee extends NPC (Bee.java:32): never hostile to the hero and immune
    // to ordinary damage (NPC.damage no-op, NPC.java:33-37).
    this.hostile = false;
    this.invulnerable = true;
    this.state = 'wandering'; // Bee init block (Bee.java:77-79)
  }

  /** Bee.damageRoll (Bee.java:123-125): NormalIntRange(HT / 10, HT / 4). */
  override mobDamageRoll(rng: MechanicsRng): number {
    return rng.normalIntRange(
      Math.floor(this.ht / 10),
      Math.floor(this.ht / 4),
    );
  }

  /**
   * The bee's enemy detection runs on the HERO's field of view
   * (Bee.chooseEnemy reads Level.fieldOfView[mob.pos], Bee.java:114) — not
   * the bee's own sight. The port's level.visible is the hero FOV
   * (recomputed on every action, level.ts).
   */
  override canSee(ctx: ActionContext, pos: number): boolean {
    return ctx.level.visible[pos] === 1;
  }

  /**
   * Bee.chooseEnemy (Bee.java:104-121): keep the current enemy while it
   * lives; otherwise pick a random hostile mob in the hero's field of
   * view. The bee never targets the hero.
   */
  protected override selectEnemy(
    ctx: ActionContext,
  ): ContentHero | ContentMob | null {
    const cur = this.enemy;
    if (cur == null || !cur.isAlive()) {
      const candidates: ContentMob[] = [];
      for (const m of ctx.mobs) {
        if (!(m instanceof ContentMob) || m === this) continue;
        if (m.hostile && m.isAlive() && ctx.level.visible[m.pos] === 1) {
          candidates.push(m);
        }
      }
      return candidates.length > 0 ? ctx.rng.pick(candidates) : null;
    }
    return cur;
  }

  /**
   * Bee.act (Bee.java:149-156): the bee loses 1 HP per action and dies
   * instead of acting when it reaches 0 — its lifespan is measured in
   * turns, not in hits taken (damage is a no-op via invulnerable).
   */
  override takeTurn(ctx: ActionContext): number {
    this.hp--;
    if (this.hp <= 0) {
      killMob(ctx, this, {});
      return this.waitCost();
    }
    if (this.state === 'wandering') {
      return this.actBeeWandering(ctx);
    }
    return super.takeTurn(ctx);
  }

  /**
   * Bee.Wandering.act (Bee.java:177-202): unlike Mob.Wandering, the bee
   * notices an enemy IMMEDIATELY (no justAlerted roll) and otherwise
   * follows the hero — getCloser(hero.pos), else spend(TICK).
   */
  private actBeeWandering(ctx: ActionContext): number {
    const enemy = this.selectEnemy(ctx);
    const enemyInFOV =
      enemy != null && enemy.isAlive() && this.canSee(ctx, enemy.pos);
    if (enemyInFOV && enemy != null) {
      this.enemySeen = true;
      this.notice(ctx); // sprite "!" alert (Mob.notice)
      this.state = 'hunting';
      this.target = enemy.pos;
      return 0; // vanilla spends nothing on the transition
    }
    this.enemySeen = false;
    const oldPos = this.pos;
    if (this.getCloser(ctx, heroOf(ctx).pos)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost(); // spend(1 / speed())
    }
    return this.waitCost(); // spend(TICK)
  }

  /**
   * Bee.attackProc (Bee.java:157-161): a mob stung by the bee is aggroed
   * onto the bee (mob.aggro(this)) — the victim hunts the bee back.
   */
  override attackProc(
    _ctx: ActionContext,
    enemy: ContentHero | ContentMob,
    damage: number,
  ): number {
    if (enemy instanceof ContentMob) {
      enemy.aggro(this);
    }
    return damage;
  }

  /**
   * Bee.interact (Bee.java:163-173): swap positions with the hero. Vanilla
   * also spends 1 / hero.speed() and calls hero.busy() — the port's talk
   * intent costs 0, so the turn cost is a known minor infidelity.
   */
  onTalk(ctx: ActionContext): void {
    const hero = heroOf(ctx);
    const curPos = this.pos;
    this.pos = hero.pos;
    hero.pos = curPos;
    ctx.syncMobs();
  }
}

/**
 * Honeypot.shatter (Honeypot.java:100-113): bee.spawn(depth); HP = HT;
 * added to the scene at the chosen cell.
 */
export function spawnBee(ctx: ActionContext, cell: number): void {
  const bee = new BeeMob(nextMobId(), cell, ctx.level.w, ctx.level.depth);
  bee.hp = bee.ht; // Honeypot.java:103 — spawn sets HT; HP is set to HT here
  ctx.addMob(bee);
}

// Module load: register the bee constructor (buildMob 'bee', save/load)
// and the honeypot summon seam.
registerBee(BeeMob);
setSummonBee((ctx, cell) => spawnBee(ctx, cell));
