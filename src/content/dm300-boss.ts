/**
 * DM-300, the Caves boss (depth 15).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/DM300.java and
 * levels/CavesBossLevel.java. Java wins every conflict. Numbers live in
 * src/mechanics/dm300.ts.
 *
 * Portrait of the fight (DM300.java):
 * - act(): seeds ToxicGas 30 at its own cell every turn, before super.act()
 *   (DM300.java:78-82).
 * - move(): repairs on INACTIVE_TRAP (DM300.java:84-91), then a random one
 *   of the 8 cells around the new position gets the rock-burst treatment —
 *   water ripples, EMPTY becomes EMPTY_DECO, and any other char on it is
 *   paralysed for 2 turns (DM300.java:93-116).
 * - notice(): yells "Unauthorised personnel detected." (DM300.java:147-150).
 * - die(): boss-slain bookkeeping (DM300.java:131), drops the skeleton key
 *   (DM300.java:132) — which unseals the arena door via the
 *   CavesBossLevel.drop port (dungeon/cavesBoss.ts) — and yells
 *   "Mission failed. Shutting down." (DM300.java:136).
 * - Resistances: Death, ScrollOfPsionicBlast — halved, not negated
 *   (DM300.java:156-163). Immunity: ToxicGas (DM300.java:166-172).
 *
 * Arena wiring (CavesBossLevel.java): the spawn placement and seal/unseal
 * triggers live in src/dungeon/cavesBoss.ts (the Level.press / Level.drop
 * ports), exposed via the arena state Worker 1's generation sets on the
 * Level (bossArena, arenaDoorCell, enteredArena, keyDropped). The spawn
 * callback is wired in actions.ts's hero-move hook, next to the Tengu one.
 */
import { Terrain } from '../core/grid.js';
import type { ActionContext } from '../engine/seams.js';
import {
  DM300_ATTACK,
  DM300_DEFENSE,
  DM300_DMG_MAX,
  DM300_DMG_MIN,
  DM300_DR,
  DM300_EXP,
  DM300_GAS_SEED,
  DM300_HT,
  DM300_IMMUNITIES,
  DM300_MAX_LVL,
  DM300_PARALYSIS_TURNS,
  DM300_RESISTANCES,
  dm300DamageRoll,
  dm300MoveCell,
  dm300Repair,
} from '../mechanics/dm300.js';
import { seedBlob } from '../mechanics/blobs.js';
import {
  charAtPos,
  ContentMob,
  dropItemAt,
  heroOf,
  registerDM300,
  type MobDef,
} from './mobs.js';

/**
 * DM300.java:54-65 — HP/HT 200, def 18, atk 28, NormalIntRange(18,24),
 * dr 10, EXP 30, maxLvl default 30 (Mob.java:69 — not overridden).
 * Name: "DM-300" on the first visit, "DM-350" on returns
 * (DM300.java:56); deepestFloor tracking lands with the meta systems, so
 * the def uses the first-visit name (Tengu precedent).
 * All numbers single-sourced from src/mechanics/dm300.ts.
 */
export const DM300_DEF: MobDef = {
  id: 'dm300',
  name: 'DM-300',
  sprite: 'mob_dm300',
  hp: DM300_HT,
  atk: DM300_ATTACK,
  def: DM300_DEFENSE,
  dmgMin: DM300_DMG_MIN,
  dmgMax: DM300_DMG_MAX,
  triangular: true,
  dr: DM300_DR,
  exp: DM300_EXP,
  maxLvl: DM300_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [...DM300_IMMUNITIES],
  resistances: [...DM300_RESISTANCES],
};

export class DM300Mob extends ContentMob {
  constructor(id: number, pos: number, w: number) {
    super(id, DM300_DEF, pos, w);
  }

  /**
   * DM300.act (DM300.java:77-82): seed ToxicGas 30 at its own cell, then
   * the normal turn. The gas seeding runs even before the mob wakes —
   * vanilla adds the blob unconditionally.
   */
  override takeTurn(ctx: ActionContext): number {
    const level = ctx.level;
    seedBlob(level.blobs, 'toxic', this.pos, DM300_GAS_SEED, level.w * level.h);
    return super.takeTurn(ctx);
  }

  /**
   * DM300.move (DM300.java:84-116), via the afterMove hook (runs with the
   * new position already set).
   */
  protected override afterMove(ctx: ActionContext, oldPos: number): void {
    // super.move(step) first: doors etc. (DM300.java:85).
    super.afterMove(ctx, oldPos);
    const rng = ctx.rng;
    const level = ctx.level;

    // Trap repair (DM300.java:86-91): stepping onto an INACTIVE_TRAP with
    // HP < HT heals HP += Random.Int(1, HT - HP).
    if (level.getAt(this.pos) === Terrain.TRAP_INACTIVE && this.hp < this.ht) {
      this.hp = dm300Repair(rng, this.hp, this.ht);
      if (level.visible[this.pos] !== 0 && heroOf(ctx).isAlive()) {
        ctx.log('DM-300 repairs itself!'); // GLog.n, DM300.java:89
      }
    }

    // The rock-burst cell (DM300.java:93-116): one of the 8 cells around
    // the new position, picked uniformly.
    const cell = dm300MoveCell(rng, this.pos, level.w, level.h);
    if (cell === -1) return;
    if (level.visible[cell] !== 0) {
      // CellEmitter rock burst + camera shake + SND_ROCKS (DM300.java:104-107):
      // visuals — the renderer owns them.
      if (level.getAt(cell) === Terrain.WATER) {
        // GameScene.ripple(cell) — visual; the renderer owns it.
      } else if (level.getAt(cell) === Terrain.FLOOR) {
        // Vanilla sets EMPTY_DECO (DM300.java:110-112); the port stores
        // EMPTY_DECO as FLOOR (painters.ts:59), so the tile is already
        // there — only the map update would show, which the engine owns.
      }
    }
    // Any other char on the cell is paralysed for 2 (DM300.java:114-116).
    const ch = charAtPos(ctx, cell, this);
    if (ch && ch.isAlive()) {
      // Buff.prolong(ch, Paralysis.class, 2) (DM300.java:115): attach sets
      // paralysed (Paralysis.java:27-35); prolong keeps the longer left.
      const cur = ch.buffs.paralysis?.left ?? 0;
      ch.buffs.paralysis = {
        kind: 'paralysis',
        left: Math.max(cur, DM300_PARALYSIS_TURNS),
      };
      ch.paralysed = true;
    }
  }

  /** DM300.notice (DM300.java:147-150). */
  protected override onNotice(ctx: ActionContext): void {
    ctx.log('Unauthorised personnel detected.'); // yell, DM300.java:149
  }

  /**
   * DM300.die (DM300.java:119-138), via the onDeath hook (runs after
   * EXP/loot in killMob).
   */
  override onDeath(ctx: ActionContext): void {
    // GameScene.bossSlain() (DM300.java:131) shows the BOSS_SLAIN banner —
    // renderer territory. Badges.validateBossSlain() is Stage 6.
    // The key drop runs the CavesBossLevel.drop port (dungeon/cavesBoss.ts
    // via dropItemAt's depth-15 dispatch): the first skeleton key re-opens
    // the collapsed arena door (DM300.java:132; CavesBossLevel.java:247-258).
    dropItemAt(ctx, this.pos, 'skeleton_key');
    ctx.log('Mission failed. Shutting down.'); // DM300.yell, DM300.java:136
  }
}

/** Exported for tests: the vanilla damage die. */
export { dm300DamageRoll };

// Register the DM-300 constructor with mobs.ts (avoids an import cycle).
registerDM300(DM300Mob);
