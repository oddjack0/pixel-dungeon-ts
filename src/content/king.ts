/**
 * Dwarf King boss (depth 20) + his Undead dwarves.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/King.java.
 * Java wins every conflict. Numbers live in src/mechanics/king.ts.
 *
 * Portrait of the fight (King.java):
 * - HP/HT 300, def 25, atk 32, NormalIntRange(20,38), dr 14, EXP 40,
 *   defenseVerb "parried" (King.java:59-94).
 * - Name: "King of Dwarves" iff depth == deepestFloor, else
 *   "undead King of Dwarves" (King.java:55).
 * - notice(): yells "How dare you!" (King.java:194-197).
 * - die(): bossSlain banner, drops ArmorKit + SkeletonKey at pos,
 *   validateBossSlain, yells "You cannot kill me, <class>... I am...
 *   immortal..." (King.java:121-133).
 * - Resistances: ToxicGas, Death, ScrollOfPsionicBlast,
 *   WandOfDisintegration — halved, not negated (King.java:206-215;
 *   halving is Char.damage via applyDamage's resistance branch).
 *   Immunities: Paralysis, Vertigo (King.java:218-225).
 * - Summoning (King.java:96-192): while Undead.count < maxArmySize() and
 *   the target pedestal is empty (or held by the king himself), the king
 *   walks to that pedestal instead of the hero (getCloser), canAttack is
 *   true only when standing on it, and the attack branch summons instead
 *   of striking — toggling to the other pedestal first. maxArmySize() =
 *   1 + 5*(HT-HP)/HT (King.java:151-153). Spawned undead go on distance
 *   rings from the king over passable-minus-chars cells (exact ring loop
 *   in mechanics/king.ts undeadSpawnCells).
 * - Undead (King$Undead, King.java:222-316): HP/HT 28, def 15, atk 16,
 *   NormalIntRange(12,16), dr 5, EXP 0, state WANDERING on spawn,
 *   defenseVerb "blocked", name "undead dwarf", immunities Death +
 *   Paralysis. attackProc: 1/5 to prolong Paralysis 1 (King.java:271-277).
 *   damage() clears ToxicGas at its pos (King.java:281-286) — implemented
 *   in the damage bridge (damageFromTrap, mechanics/traps.ts), the only
 *   place the port still knows the damage src was a ToxicGas blob via the
 *   'toxic_gas' sourceTag. die() plays SND_BONES when visible
 *   (King.java:289-295).
 *
 * ARENA WIRING (for the City boss level worker):
 * - Call setKingPedestals(left, right) from src/mechanics/king.ts at
 *   generation time (CityBossLevel.pedestal(true/false), CityBossLevel.java:137-143).
 * - On arena entry (CityBossLevel.press, CityBossLevel.java:176-200), call
 *   spawnKingArena(ctx, pos): constructs the King (Undead.count reset,
 *   King.java:64), state HUNTING, GameScene.add, notice() when the spawn
 *   cell is hero-visible, then lock the arena door (owned by the level).
 * - On skeleton_key drop (CityBossLevel.drop, CityBossLevel.java:203-214),
 *   turn the arena door into an ordinary door — same hook pattern as
 *   prisonBoss.ts onItemDropped / dropItemAt's depth-15 branch (that
 *   wiring belongs to the level worker; do NOT add a depth-20 branch to
 *   dropItemAt in mobs.ts from this module).
 * - setKingDeepestFloor(d) when the meta system knows Statistics.deepestFloor
 *   (King.java:55); unset means "first descent", which is always deepest.
 */
import { buildDistanceMap } from '../mechanics/wands.js';
import {
  KING_ATTACK,
  KING_DEFENSE,
  KING_DMG_MAX,
  KING_DMG_MIN,
  KING_DR,
  KING_EXP,
  KING_HT,
  KING_IMMUNITIES,
  KING_MAX_LVL,
  KING_RESISTANCES,
  UNDEAD_ATTACK,
  UNDEAD_DEFENSE,
  UNDEAD_DMG_MAX,
  UNDEAD_DMG_MIN,
  UNDEAD_DR,
  UNDEAD_EXP,
  UNDEAD_HT,
  UNDEAD_IMMUNITIES,
  UNDEAD_MAX_LVL,
  UNDEAD_PARALYSIS_DIE,
  UNDEAD_PARALYSIS_TURNS,
  kingDisplayName,
  kingMaxArmySize,
  kingPedestal,
  kingUndeadsToSummon,
  setKingPedestals,
  undeadSpawnCells,
} from '../mechanics/king.js';
import { prolongBuff } from './enchantments.js';
import {
  charAtPos,
  ContentMob,
  dropItemAt,
  heroOf,
  nextMobId,
  type MobDef,
} from './mobs.js';
import { ITEMS } from './items.js';
import type { ContentHero } from './hero.js';
import type { ActionContext } from '../engine/seams.js';

export { setKingPedestals };

/**
 * King's mob def. King.java:59-65 — HP/HT 300, EXP 40, def 25;
 * the name is set per-instance (King.java:55) in the constructor.
 */
export const KING_DEF: MobDef = {
  id: 'king',
  name: 'King of Dwarves',
  sprite: 'mob_king',
  hp: KING_HT,
  atk: KING_ATTACK,
  def: KING_DEFENSE,
  dmgMin: KING_DMG_MIN,
  dmgMax: KING_DMG_MAX,
  triangular: true,
  dr: KING_DR,
  exp: KING_EXP,
  maxLvl: KING_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [...KING_IMMUNITIES],
  resistances: [...KING_RESISTANCES],
};

/**
 * Undead dwarf mob def. King$Undead (King.java:229-235) — HP/HT 28, def 15,
 * EXP 0, state WANDERING on spawn (set in the constructor).
 */
export const UNDEAD_DEF: MobDef = {
  id: 'king_undead',
  name: 'undead dwarf',
  sprite: 'mob_undead',
  hp: UNDEAD_HT,
  atk: UNDEAD_ATTACK,
  def: UNDEAD_DEFENSE,
  dmgMin: UNDEAD_DMG_MIN,
  dmgMax: UNDEAD_DMG_MAX,
  triangular: true,
  dr: UNDEAD_DR,
  exp: UNDEAD_EXP,
  maxLvl: UNDEAD_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [...UNDEAD_IMMUNITIES],
  resistances: [],
};

/**
 * Undead.count (King.java:224): incremented on add, decremented on remove.
 * The port has no onAdd/onRemove mob hooks, so the count is maintained here:
 * incremented in summonKingUndead, decremented in UndeadMob.onDeath (the
 * port's only removal path for summoned undead), and reset in the King
 * constructor (King.java:64).
 */
let undeadCount = 0;
/** Current Undead.count — the army-size budget source of truth. */
export function getUndeadCount(): number {
  return undeadCount;
}
/** Reset Undead.count (level reload in tests). */
export function resetUndeadCount(): void {
  undeadCount = 0;
}

/** Statistics.deepestFloor analog; null until the meta systems record it. */
let kingDeepestFloor: number | null = null;
/** Set Statistics.deepestFloor for the King name rule (King.java:55). */
export function setKingDeepestFloor(d: number | null): void {
  kingDeepestFloor = d;
}

export class UndeadMob extends ContentMob {
  constructor(id: number, pos: number, w: number) {
    super(id, UNDEAD_DEF, pos, w);
    this.state = 'wandering'; // King.java:237
  }

  /**
   * Undead.attackProc (King.java:271-277): Random.Int(MAX_ARMY_SIZE) == 0
   * -> Buff.prolong(enemy, Paralysis.class, 1).
   */
  override attackProc(
    ctx: ActionContext,
    hero: ContentHero,
    damage: number,
  ): number {
    if (ctx.rng.int(0, UNDEAD_PARALYSIS_DIE) === 0) {
      prolongBuff(hero, 'paralysis', UNDEAD_PARALYSIS_TURNS);
      hero.paralysed = true;
    }
    return damage;
  }

  /**
   * Undead.die (King.java:289-295): Sample.INSTANCE.play(SND_BONES) when
   * visible — audio is renderer territory; the death itself goes through
   * the normal pipeline. Undead.count-- (King.java:245-249).
   */
  override onDeath(_ctx: ActionContext): void {
    undeadCount--;
    // SND_BONES (King.java:292-294): no audio system in the port yet —
    // visuals/audio are renderer territory, as for the other bosses.
  }
}

export class KingMob extends ContentMob {
  /** King.nextPedestal (King.java:66), starts true (the left pedestal). */
  nextPedestal = true;
  /** Depth at spawn — for the King.java:55 name rule. */
  private spawnDepth: number;

  constructor(
    id: number,
    pos: number,
    w: number,
    spawnDepth: number,
    deepestFloor: number | null = null,
  ) {
    super(id, KING_DEF, pos, w);
    this.spawnDepth = spawnDepth;
    // King.java:55 — name depends on whether we're at the deepest floor.
    this.name = kingDisplayName(spawnDepth, deepestFloor ?? kingDeepestFloor);
    // King.java:64 — the instance initializer resets the army counter.
    undeadCount = 0;
  }

  /** King.canTryToSummon (King.java:106-113). */
  canTryToSummon(ctx: ActionContext): boolean {
    if (undeadCount < kingMaxArmySize(this.hp, this.ht)) {
      const ch = charAtPos(ctx, kingPedestal(this.nextPedestal), this);
      return ch === this || ch === undefined;
    }
    return false;
  }

  /**
   * King.getCloser (King.java:96-101): head for the pedestal while the
   * king can still summon, otherwise hunt the target.
   */
  override getCloser(ctx: ActionContext, target: number): boolean {
    return this.canTryToSummon(ctx)
      ? super.getCloser(ctx, kingPedestal(this.nextPedestal))
      : super.getCloser(ctx, target);
  }

  /**
   * King.canAttack (King.java:103-108): when summoning, true only standing
   * on the target pedestal; otherwise plain adjacency.
   */
  override canAttack(ctx: ActionContext, targetPos: number): boolean {
    return this.canTryToSummon(ctx)
      ? this.pos === kingPedestal(this.nextPedestal)
      : super.canAttack(ctx, targetPos);
  }

  /**
   * King.attack (King.java:115-131): if on the pedestal with room for more
   * undead, summon (no strike); otherwise, if the hero stands on the
   * target pedestal, switch to the other one and strike normally.
   */
  override doAttack(ctx: ActionContext, hero: ContentHero): number {
    if (this.canTryToSummon(ctx) && this.pos === kingPedestal(this.nextPedestal)) {
      this.summon(ctx);
      return this.attackCost(); // vanilla spends attackDelay() via Mob.act
    }
    if (charAtPos(ctx, kingPedestal(this.nextPedestal), this) === hero) {
      this.nextPedestal = !this.nextPedestal;
    }
    return super.doAttack(ctx, hero);
  }

  /**
   * King.summon (King.java:155-192). Exact sequence: toggle the pedestal,
   * Speck.SCREAM + SND_CHALLENGE (renderer/audio territory — noted), build
   * a passable-minus-chars map, BFS from the king's cell for at most
   * (maxArmySize - count) steps, exclude the king's own cell, and place
   * undead on distance rings via the exact ring loop. Each spawn gets the
   * WandOfBlink.appear + Flare treatment (visuals — renderer territory,
   * noted below) and yells "Arise, slaves!".
   */
  summon(ctx: ActionContext): void {
    this.nextPedestal = !this.nextPedestal; // King.java:157

    // sprite.centerEmitter().start(Speck.factory(Speck.SCREAM), 0.4f, 2)
    // (King.java:159) + Sample.INSTANCE.play(Assets.SND_CHALLENGE)
    // (King.java:160): visuals/audio — the renderer owns them.

    // Level.passable clone minus every char's cell (King.java:162-167).
    const level = ctx.level;
    const blocked = new Set<number>();
    for (const m of ctx.mobs) {
      // MobActor exposes x/y; every live char blocks the distance map.
      if (m.isAlive()) blocked.add(m.y * level.w + m.x);
    }
    const hero = heroOf(ctx);
    if (hero.isAlive()) blocked.add(hero.pos);

    const undeadsToSummon = kingUndeadsToSummon(
      kingMaxArmySize(this.hp, this.ht),
      undeadCount,
    ); // King.java:168

    // PathFinder.buildDistanceMap(pos, passable, undeadsToSummon) —
    // the port's helper in mechanics/wands.ts (4-neighbourhood BFS; see the
    // report for the vanilla-noosa neighbourhood caveat).
    const distance = buildDistanceMap(
      level.w,
      level.h,
      this.pos,
      (pos) => {
        const x = pos % level.w;
        const y = Math.floor(pos / level.w);
        return !blocked.has(pos) && level.isPassable(x, y);
      },
      undeadsToSummon,
    );
    distance[this.pos] = Infinity; // PathFinder.distance[pos] = MAX (King.java:170)

    // Exact ring loop (King.java:171-190) — mechanics/king.ts.
    const cells = undeadSpawnCells(distance, level.w * level.h, undeadsToSummon);

    for (const cell of cells) {
      const undead = new UndeadMob(nextMobId(), cell, level.w);
      ctx.addMob(undead); // GameScene.add(undead) (King.java:177)
      undeadCount++; // Undead.onAdd (King.java:240-244)
      // WandOfBlink.appear(undead, j) (King.java:179) — blink visuals are
      // renderer territory; no port hook exists for the appear effect yet.
      // new Flare(3, 32).color(0x000000, false).show(undead.sprite, 2f)
      // (King.java:180) — particle effect, renderer territory.
    }

    ctx.log('Arise, slaves!'); // King.yell (King.java:192)
  }

  /** King.notice (King.java:194-197). */
  protected override onNotice(ctx: ActionContext): void {
    super.onNotice(ctx);
    ctx.log('How dare you!');
  }

  /**
   * King.die (King.java:121-133), via the onDeath hook (runs after
   * EXP/loot in killMob): bossSlain banner (renderer territory),
   * ArmorKit + SkeletonKey drops, validateBossSlain (Stage 6), and the
   * death yell. The port has no class titles yet (single warrior), so the
   * <hero class> slot is "warrior" (same convention as Tengu.notice).
   */
  override onDeath(ctx: ActionContext): void {
    // GameScene.bossSlain() (King.java:126) shows the BOSS_SLAIN banner —
    // renderer territory, as for Tengu/DM-300.
    if (ITEMS['armor_kit']) {
      dropItemAt(ctx, this.pos, 'armor_kit'); // King.java:127
    }
    // SkeletonKey (King.java:128) — the CityBossLevel.drop port (level
    // worker) turns the arena door into an ordinary door on this drop.
    dropItemAt(ctx, this.pos, 'skeleton_key');
    // Badges.validateBossSlain() (King.java:131) is Stage 6.
    ctx.log('You cannot kill me, warrior... I am... immortal...'); // King.java:132
  }
}

// Blocked cells for the summoning BFS are built per-summon call above
// (King.java:163-167 — `passable[((Char)actor).pos] = false`).

/**
 * Arena-entry spawn (CityBossLevel.press, CityBossLevel.java:176-200):
 * the King spawns HUNTING at the given cell (the level worker picks it:
 * random passable cell outside the entrance room, preferring hero-invisible
 * cells — CityBossLevel.java:181-189), notice() fires when the spawn cell
 * is hero-visible (CityBossLevel.java:191-195), and the level locks the
 * arena door behind the hero (level-owned, like prisonBoss.pressArenaCell).
 */
export function spawnKingArena(ctx: ActionContext, pos: number): KingMob {
  const king = new KingMob(
    nextMobId(),
    pos,
    ctx.level.w,
    ctx.level.depth,
    kingDeepestFloor,
  );
  king.state = 'hunting'; // CityBossLevel.java:183
  ctx.addMob(king); // GameScene.add (CityBossLevel.java:190)
  if (ctx.level.visible[pos]) {
    king.notice(ctx); // boss.notice() (CityBossLevel.java:192-195)
  }
  return king;
}
