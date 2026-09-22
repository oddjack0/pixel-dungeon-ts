/**
 * Goo, the Sewers boss (depth 5).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/Goo.java.
 * Java wins every conflict. Turn logic ports Goo.act/doAttack/move/die
 * (Goo.java:84-204); numbers live in src/mechanics/goo.ts.
 *
/**
 * SewerBossLevel.seal/unseal (SewerBossLevel.java:201-217): the seal converts
 * the entrance-stairs tile to water (stairs are gone, not just flagged), so
 * the hero cannot leave while Goo lives; unseal restores the entrance tile.
 * The engine additionally refuses the ascend intent while level.sealed.
 */
export function sealArena(level: Level): void {
  if (level.sealed) return;
  level.sealed = true;
  const sx = level.stairsUp % level.w;
  const sy = Math.floor(level.stairsUp / level.w);
  if (level.get(sx, sy) === Terrain.ENTRANCE) {
    level.set(sx, sy, Terrain.WATER);
  }
}

export function unsealArena(level: Level): void {
  if (!level.sealed) return;
  level.sealed = false;
  const sx = level.stairsUp % level.w;
  const sy = Math.floor(level.stairsUp / level.w);
  if (level.get(sx, sy) === Terrain.WATER) {
    level.set(sx, sy, Terrain.ENTRANCE);
  }
}
import { Terrain } from '../core/grid.js';
import { type Level } from '../dungeon/level.js';
import type { ActionContext } from '../engine/seams.js';
import {
  gooAfterAttack,
  gooAfterMove,
  gooAttackSkill,
  gooCanAttack,
  gooDamageRoll,
  gooDecide,
  gooOozeRoll,
  gooWaterRegen,
  type GooAction,
  GOO_ATTACK,
  GOO_DEFENSE,
  GOO_DMG_MAX,
  GOO_DMG_MIN,
  GOO_DR,
  GOO_EXP,
  GOO_HT,
  GOO_MAX_LVL,
  GOO_RESISTANCES,
  PUMP_UP_DELAY,
} from '../mechanics/goo.js';
import {
  chebyshevPos,
  ContentMob,
  dropItemAt,
  registerGoo,
  strikeMobVsHero,
  type MobDef,
} from './mobs.js';
import type { ContentHero } from './hero.js';

/**
 * Goo.java:41-59 — HP/HT 80, def 12, atk 15 (30 pumped), NormalIntRange(2,12)
 * (5-30 pumped), dr 2, EXP 10, maxLvl default 30 (Mob.java:69 — Goo does not
 * override it), resistances ToxicGas/Death/ScrollOfPsionicBlast
 * (Goo.java:228-233; M1: no such effects exist yet, tags are forward-looking).
 * All numbers are single-sourced from src/mechanics/goo.ts.
 */
export const GOO_DEF: MobDef = {
  id: 'goo',
  name: 'Goo',
  sprite: 'mob_goo',
  hp: GOO_HT,
  atk: GOO_ATTACK,
  def: GOO_DEFENSE,
  dmgMin: GOO_DMG_MIN,
  dmgMax: GOO_DMG_MAX,
  triangular: true,
  dr: GOO_DR,
  exp: GOO_EXP,
  maxLvl: GOO_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [],
  resistances: [...GOO_RESISTANCES],
};

export class GooMob extends ContentMob {
  pumpedUp = false; // Goo.pumpedUp (Goo.java:60)
  jumped = false; // Goo.jumped (Goo.java:61)

  constructor(id: number, pos: number, w: number) {
    super(id, GOO_DEF, pos, w);
  }

  /** canAttack: adjacent, or distance <= 2 while pumped (Goo.canAttack). */
  override canAttack(_ctx: ActionContext, targetPos: number): boolean {
    return gooCanAttack(this.pumpedUp, chebyshevPos(this.pos, targetPos, this.w));
  }

  /** Goo.act: regenerate 1 HP/turn in water (Goo.java:84-89), before AI. */
  override takeTurn(ctx: ActionContext): number {
    this.hp = gooWaterRegen(this.hp, ctx.level.getAt(this.pos) === Terrain.WATER);
    return super.takeTurn(ctx);
  }

  /** Goo.notice: yells "GLURP-GLURP!" (Goo.java:207-210). */
  protected override onNotice(ctx: ActionContext): void {
    ctx.log('GLURP-GLURP!'); // TXT_NOTICE
  }

  /** Goo.move: seal the arena (Goo.java:186-191 -> SewerBossLevel.seal). */
  protected override afterMove(ctx: ActionContext, _oldPos: number): void {
    if (!ctx.level.sealed) {
      sealArena(ctx.level);
      ctx.log('The dungeon seals shut behind you!');
    }
    const s = gooAfterMove({
      hp: this.hp,
      pumpedUp: this.pumpedUp,
      jumped: this.jumped,
    });
    this.pumpedUp = s.pumpedUp; // Goo.move resets pumpedUp (Goo.java:191)
  }

  /**
   * Goo.die (Goo.java:194-204): unseal, drop the Skeleton Key (100%), yell.
   * (super.die -> EXP/loot happen first, in killMob.)
   */
  override onDeath(ctx: ActionContext): void {
    unsealArena(ctx.level); // SewerBossLevel.unseal()
    dropItemAt(ctx, this.pos, 'skeleton_key'); // Goo.java:196
    ctx.log('glurp... glurp...'); // Goo.yell, Goo.java:200
  }

  /**
   * Post-strike state via the pure mirror (src/mechanics/goo.ts). The
   * pre-strike `jumped` writes happen inline in doAttack, exactly where
   * Goo.java writes them (Goo.java:115, 121).
   */
  private applyGooAfter(action: GooAction): void {
    const s = gooAfterAttack(
      { hp: this.hp, pumpedUp: this.pumpedUp, jumped: this.jumped },
      action,
    );
    this.pumpedUp = s.pumpedUp;
    this.jumped = s.jumped;
  }

  /**
   * Goo.doAttack (Goo.java:104-170): pumped strike, jump strike, pump-up,
   * or the 1/3 pump fizzle that spends the turn.
   */
  override doAttack(ctx: ActionContext, hero: ContentHero): number {
    const rng = ctx.rng;
    const dist = chebyshevPos(this.pos, hero.pos, this.w);
    const action = gooDecide(
      rng,
      { hp: this.hp, pumpedUp: this.pumpedUp, jumped: this.jumped },
      { dist, jumpPathClear: this.jumpPathClear(ctx, hero) },
    );
    switch (action.kind) {
      case 'pump': {
        // Goo.java:158-167: pumpedUp = true (jumped untouched), spend(2).
        ctx.log('Goo is pumping itself up!'); // GLog.n, Goo.java:164
        this.applyGooAfter(action);
        return PUMP_UP_DELAY * this.getSpeed(); // spend(PUMP_UP_DELAY), Goo.java:159
      }
      case 'pumpFizzle':
        // Goo.java:144-148: pumpedUp = false (jumped untouched), turn spent.
        this.applyGooAfter(action);
        return this.waitCost();
      case 'pumpedAttack': {
        // Goo.java:112-118: jumped = false BEFORE the strike — pumped attack
        // WITHOUT accuracy penalty (attackSkill 30).
        this.jumped = false;
        this.gooStrike(ctx, hero, gooAttackSkill(true, this.jumped), true);
        this.applyGooAfter(action);
        return 1 * this.getSpeed(); // spend(attackDelay())
      }
      case 'attack': {
        // Goo.java:150-156: normal attack (attackSkill 15); jumped untouched.
        // The attack() wrapper then clears pumpedUp only (Goo.java:176-180).
        this.gooStrike(ctx, hero, gooAttackSkill(false, this.jumped), false);
        this.applyGooAfter(action);
        return 1 * this.getSpeed(); // spend(attackDelay())
      }
      case 'jumpAttack': {
        // Goo.java:119-143: jumped = true BEFORE the strike — pumped attack
        // WITH accuracy penalty (attackSkill 15). The leap lands in the cell
        // before the hero along the jump trace (Ballistica.trace[distance-2]).
        this.jumped = true;
        this.pos = this.jumpDest(ctx, hero);
        ctx.log('Goo jumps!');
        this.gooStrike(ctx, hero, gooAttackSkill(true, this.jumped), true);
        this.applyGooAfter(action);
        return 1 * this.getSpeed(); // spend(attackDelay())
      }
    }
  }

  /** Goo strike with explicit accuracy and pumped damage (Goo.damageRoll). */
  private gooStrike(
    ctx: ActionContext,
    hero: ContentHero,
    accuracy: number,
    pumped: boolean,
  ): void {
    strikeMobVsHero(
      ctx,
      this,
      hero,
      accuracy,
      (rng) => gooDamageRoll(rng, pumped),
      (rng, damage) => {
        // Goo.attackProc: 1/3 chance to apply Ooze (Goo.java:174-180).
        // The warning text is Hero.add's Ooze branch (Hero.java:1091).
        if (gooOozeRoll(rng)) {
          hero.buffs.ooze = { kind: 'ooze', left: 0 }; // duration-less (Ooze.java)
          ctx.log('Caustic ooze eats your flesh. Wash away it!');
        }
        return damage;
      },
    );
  }

  /**
   * Jump landing (Goo.doAttack, Goo.java:117): dest =
   * Ballistica.trace[Ballistica.distance - 2] — the cell BEFORE the hero
   * along the jump trace, i.e. adjacent to the hero on Goo's side. M1
   * approximates the trace cell as hero - sign(hero - goo); the landing cell
   * is validated (in-bounds, walkable, unoccupied) and Goo stays put if it
   * is invalid.
   */
  private jumpDest(ctx: ActionContext, hero: ContentHero): number {
    const dx = Math.sign(hero.x - this.x);
    const dy = Math.sign(hero.y - this.y);
    const nx = hero.x - dx;
    const ny = hero.y - dy;
    const level = ctx.level;
    if (
      level.inBounds(nx, ny) &&
      level.isPassable(nx, ny) &&
      !level.mobAt(nx, ny)
    ) {
      return ny * this.w + nx;
    }
    return this.pos; // invalid landing: jump in place, still strike
  }

  /** Ballistic path clear from Goo to the hero (Ballistica, Goo.java:95). */
  private jumpPathClear(ctx: ActionContext, hero: ContentHero): boolean {
    return lineClear(ctx.level, this.x, this.y, hero.x, hero.y);
  }
}

/**
 * Super-lossy line-of-sight: Bresenham through non-opaque tiles.
 * (Mechanics' ballisticPath exists but needs a 5-arg signature; the
 * gooDecide contract takes jumpPathClear as a precomputed boolean.)
 */
function lineClear(
  level: Level,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (level.isOpaque(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Register the Goo constructor with mobs.ts (avoids an import cycle).
registerGoo(GooMob);
