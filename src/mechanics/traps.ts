/**
 * Stage 0 trap trigger system — faithful port of the vanilla trap machinery:
 *   levels/Level.java: press() (trap cases, Level.java:619-721) and
 *     mobPress() (Level.java:723-775),
 *   levels/traps/AlarmTrap.java, FireTrap.java, GrippingTrap.java,
 *   LightningTrap.java, ParalyticTrap.java, PoisonTrap.java,
 *   SummoningTrap.java, ToxicTrap.java.
 *
 * TRIGGER RULES (from Level.press / Level.mobPress):
 * - The hero (or any char via press()) triggers BOTH hidden (SECRET_*) and
 *   revealed traps. A hidden trap logs "A hidden pressure plate clicks!"
 *   (TXT_HIDDEN_PLATE_CLICKS, Level.java:94) via GLog.i.
 * - Mobs (mobPress) trigger ONLY revealed traps; hidden traps never fire
 *   for mobs.
 * - Every trigger is single-use: the tile becomes INACTIVE_TRAP afterwards.
 * - press(): plays SND_TRAP, hero.interrupt() when the hero triggers.
 *   mobPress(): plays SND_TRAP only when the cell is visible.
 *   (Audio has no seam in M1 — the renderer owns SFX; noted at call sites.)
 *
 * EFFECTS (each verified against its Java file; formulas cited inline):
 * - Toxic:     ToxicGas blob, seed 300 + 20 * depth (ToxicTrap.java:34)
 * - Fire:      Fire blob, seed 2 (FireTrap.java:34)
 * - Paralytic: ParalyticGas blob, seed 80 + 5 * depth (ParalyticTrap.java:34)
 * - Poison:    Poison buff, durationFactor * (4 + depth / 2) (PoisonTrap.java:34)
 * - Alarm:     beckon every mob except the triggerer (AlarmTrap.java)
 * - Lightning: max(1, Int(HP/3, 2*HP/3)); hero: shake + death message or
 *              belongings.charge(false) — ADDS a charge to each wand below
 *              max (Belongings.java:200), it does NOT discharge
 *              (LightningTrap.java)
 * - Gripping:  Bleeding.set(max(0, (depth+3) - IntRange(0, dr()/2))) +
 *              Cripple prolonged 10 (GrippingTrap.java)
 * - Summoning: 1-3 mobs (Bestiary.mob(depth), WANDERING, +2 delay), never on
 *              boss levels (SummoningTrap.java)
 *
 * Layering: this module lives in mechanics/ and must not import content/
 * (one-way dependency). TrapChar is the structural view ContentHero /
 * ContentMob satisfy; mob construction for SummoningTrap is injected via
 * TrapSummoner (the content call site builds the mob).
 */
import type { MechanicsRng } from './rng.js';
import type { ActionContext, MobActor } from '../engine/seams.js';
import { Terrain, isHiddenTrap } from '../core/grid.js';
import type { Level } from '../dungeon/level.js';
import { applyDamage, type DamageTarget } from './combat.js';
import {
  BURNING_DURATION,
  CRIPPLE_DURATION,
  bleedingTick,
  poisonTrapDuration,
} from './buffs.js';
import {
  isFlamableForBlob,
  isSolidForBlob,
  seedBlob,
  type BlobChar,
} from './blobs.js';
import type { BlobWorld } from './blobs.js';

/** Exact strings from the Java source. */
export const TXT_HIDDEN_PLATE_CLICKS = 'A hidden pressure plate clicks!'; // Level.java:94
export const TXT_ALARM_SOUND =
  'The trap emits a piercing sound that echoes throughout the dungeon!'; // AlarmTrap.java
export const TXT_LIGHTNING_DEATH =
  'You were killed by a discharge of a lightning trap...'; // LightningTrap.java
export const TXT_BLEEDING_DEATH = 'You bled to death...'; // Bleeding.java:70

/** The 8 trap kinds, in vanilla levels/traps/ order. */
export type TrapKind =
  | 'toxic'
  | 'fire'
  | 'paralytic'
  | 'poison'
  | 'alarm'
  | 'lightning'
  | 'gripping'
  | 'summoning';

/** Structural view of the hero for trap effects (ContentHero satisfies this). */
export interface TrapHero extends BlobChar {
  kind: 'hero';
  id: number;
  armor: { dr: number; level: number } | null;
}

/** Structural view of a mob for trap effects (ContentMob satisfies this). */
export interface TrapMob extends BlobChar {
  kind: 'mob';
  id: number;
  def: { dr: number };
  state: 'sleeping' | 'wandering' | 'hunting' | 'fleeing' | 'passive';
  target: number;
  /** NPC invulnerability (NPC.damage is a no-op, NPC.java:45-47). */
  invulnerable?: boolean;
  /** Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184). */
  onDamaged?: (ctx: ActionContext) => void;
}

export type TrapChar = TrapHero | TrapMob;

/**
 * Builds + registers a summoned mob (SummoningTrap: Bestiary.mob(depth),
 * state = WANDERING, GameScene.add(mob, DELAY), WandOfBlink.appear).
 * Implemented by the content call site (it owns mob construction).
 */
export type TrapSummoner = (mobId: string, pos: number) => void;

/** Hidden + revealed tile -> trap kind, or null when not a trap tile. */
export function trapKindOf(t: Terrain): TrapKind | null {
  switch (t) {
    case Terrain.TRAP_TOXIC:
    case Terrain.TRAP_TOXIC_HIDDEN:
      return 'toxic';
    case Terrain.TRAP_FIRE:
    case Terrain.TRAP_FIRE_HIDDEN:
      return 'fire';
    case Terrain.TRAP_PARALYTIC:
    case Terrain.TRAP_PARALYTIC_HIDDEN:
      return 'paralytic';
    case Terrain.TRAP_POISON:
    case Terrain.TRAP_POISON_HIDDEN:
      return 'poison';
    case Terrain.TRAP_ALARM:
    case Terrain.TRAP_ALARM_HIDDEN:
      return 'alarm';
    case Terrain.TRAP_LIGHTNING:
    case Terrain.TRAP_LIGHTNING_HIDDEN:
      return 'lightning';
    case Terrain.TRAP_GRIPPING:
    case Terrain.TRAP_GRIPPING_HIDDEN:
      return 'gripping';
    case Terrain.TRAP_SUMMONING:
    case Terrain.TRAP_SUMMONING_HIDDEN:
      return 'summoning';
    default:
      return null;
  }
}

/**
 * Effective dr() for the GrippingTrap formula.
 * Hero.dr(): max(armor.DR(), 0) (Hero.java:307-314); Mob.dr(): def.dr.
 */
export function trapCharDr(ch: TrapChar): number {
  if (ch.kind === 'hero') {
    // ArmorDef.dr is the level-0 cap (tier * 2); effective DR adds level
    // (Armor.DR(), Armor.java:145-147).
    return ch.armor ? Math.max(ch.armor.dr + ch.armor.level, 0) : 0;
  }
  return ch.def.dr;
}

/**
 * Vanilla Char.damage(dmg, src) as used by traps/blobs: immunities /
 * resistances, the paralysis-break roll (Char.java:269-275), HP update.
 * On death the trap's death message logs for the hero; mobs are removed
 * via the engine seam (vanilla: die() immediately).
 */
export function damageFromTrap(
  ctx: ActionContext,
  rng: MechanicsRng,
  ch: TrapChar,
  dmg: number,
  sourceTag: string,
  onHeroDeath?: () => void,
): void {
  // NPC.damage is a no-op (NPC.java:45-47): invulnerable NPCs (ghost,
  // wandmaker, shopkeeper) never take damage from anything.
  if (ch.kind === 'mob' && ch.invulnerable) return;
  const target: DamageTarget = {
    hp: ch.hp,
    ht: ch.ht,
    paralysed: ch.paralysed,
    immunities: ch.immunities,
    resistances: ch.resistances,
  };
  const applied = applyDamage(rng, target, dmg, sourceTag);
  ch.hp = applied.hp;
  if (applied.paralysisBroken) {
    ch.paralysed = false;
    delete ch.buffs.paralysis;
  }
  if (applied.died) {
    if (ch.kind === 'hero') {
      onHeroDeath?.();
    } else {
      ctx.killMob(ch as unknown as MobActor);
    }
  } else if (ch.kind === 'mob') {
    // Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184):
    // trap damage is a damage call like any other.
    ch.onDamaged?.(ctx);
  }
}

/** Vanilla Mob.beckon(cell) (Mob.java:399-407): notice + hunt/wander retarget. */
export function beckonMob(mob: TrapMob, cell: number): void {
  // NPC.beckon is a no-op (NPC.java:50-52): quest NPCs ignore alarm traps.
  if (mob.invulnerable) return;
  // notice(): sprite.showAlert() — visual; the renderer owns it.
  if (mob.state !== 'hunting') {
    mob.state = 'wandering';
  }
  mob.target = cell;
}

/**
 * BlobWorld over the live Level + ActionContext (see mechanics/blobs.ts).
 * Reused by trap-seeded blobs and their evolve ticks.
 */
export function makeBlobWorld(
  ctx: ActionContext,
  hero: TrapHero,
  mobs: TrapMob[],
): BlobWorld {
  const level: Level = ctx.level;
  return {
    w: level.w,
    length: level.w * level.h,
    depth: level.depth,
    blobs: level.blobs,
    solidAt: (pos) => isSolidForBlob(level.getAt(pos)),
    flamableAt: (pos) => isFlamableForBlob(level.getAt(pos)),
    tileAt: (pos) => level.getAt(pos),
    setTile: (pos, t) => {
      const { x, y } = level.xy(pos);
      level.set(x, y, t as Terrain);
    },
    charAt: (pos) => {
      if (hero.isAlive() && hero.pos === pos) return hero;
      return mobs.find((m) => m.isAlive() && m.pos === pos) ?? null;
    },
    visibleAt: (pos) => level.visible[pos] !== 0,
    damageChar: (rng, ch, dmg, sourceTag, onHeroDeath) =>
      damageFromTrap(ctx, rng, ch as TrapChar, dmg, sourceTag, onHeroDeath
        ? () => onHeroDeath(ch)
        : undefined),
    reigniteBurning: (ch) => {
      // NPC.add(Buff) is a no-op (NPC.java:41-43).
      if (ch.invulnerable) return;
      // Elemental.add (Elemental.java:67-76): a Burning attach heals the
      // elemental 1 HP instead (if hurt) and never sticks. Only the fire
      // elemental lists Burning among its immunities, so the tag check is
      // exact for the reachable roster.
      if (ch.immunities.includes('burning')) {
        if (ch.hp < ch.ht) ch.hp += 1;
        return;
      }
      // Buff.affect(ch, Burning.class).reignite(ch): left = duration = 8
      // (Burning.java:109-111; no RingOfElements in M1).
      ch.buffs.burning = { kind: 'burning', left: BURNING_DURATION };
    },
    prolongParalysis: (ch, duration) => {
      // NPC.add(Buff) is a no-op (NPC.java:41-43).
      if (ch.invulnerable) return;
      // Buff.prolong: affect + postpone(duration) = max(existing, duration)
      // (Buff.java:85-89, Actor.postpone); attach sets paralysed
      // (Paralysis.java:27-35).
      const cur = ch.buffs.paralysis?.left ?? 0;
      ch.buffs.paralysis = { kind: 'paralysis', left: Math.max(cur, duration) };
      ch.paralysed = true;
    },
    prolongRoots: (ch) => {
      // NPC.add(Buff) is a no-op (NPC.java:41-43).
      if (ch.invulnerable) return;
      // Roots.attachTo refuses flying chars (Roots.java); prolong = max
      // with TICK = 1 (Buff.java:85-89; Web.java prolongs by TICK).
      if (ch.flying) return;
      const cur = ch.buffs.roots?.left ?? 0;
      ch.buffs.roots = { kind: 'roots', left: Math.max(cur, 1) };
      ch.rooted = true;
    },
    burnOutTile: (pos) => {
      // Fire burning out on a flamable tile (Fire.java): oldTile = map[pos];
      // level.destroy(pos); updateMap(pos); if visible: discoverTile(oldTile).
      // Level.destroy (Level.java:475-493): EMBERS, unless UNSTITCHABLE —
      // then flood to water when a 4-neighbour is water, else EMBERS.
      // Vanilla UNSTITCHABLE flamables: DOOR, BOOKSHELF (Terrain.java flags).
      const t = level.getAt(pos);
      const unstitchable = t === Terrain.DOOR || t === Terrain.BOOKSHELF;
      let burned: Terrain = Terrain.EMBERS;
      if (unstitchable) {
        const { x, y } = level.xy(pos);
        const flooded = level
          .neighbors4(x, y)
          .some((n) => level.get(n.x, n.y) === Terrain.WATER);
        if (flooded) burned = Terrain.WATER;
      }
      const { x, y } = level.xy(pos);
      level.set(x, y, burned);
      // GameScene.updateMap / discoverTile / Dungeon.observe(): renderer +
      // FOV refresh — the engine owns them.
    },
    log: (msg) => ctx.log(msg),
  };
}

/* ------------------------------------------------------------------ */
/* Trap effects                                                        */
/* ------------------------------------------------------------------ */

/** ToxicTrap.trigger (ToxicTrap.java): ToxicGas seeded 300 + 20 * depth. */
function toxicTrap(ctx: ActionContext, cell: number): void {
  const level = ctx.level;
  seedBlob(level.blobs, 'toxic', cell, 300 + 20 * level.depth, level.w * level.h);
}

/** FireTrap.trigger (FireTrap.java:34): Fire seeded 2. */
function fireTrap(ctx: ActionContext, cell: number): void {
  const level = ctx.level;
  seedBlob(level.blobs, 'fire', cell, 2, level.w * level.h);
  // CellEmitter flame burst — visual; the renderer owns it.
}

/** ParalyticTrap.trigger (ParalyticTrap.java:34): ParalyticGas 80 + 5 * depth. */
function paralyticTrap(ctx: ActionContext, cell: number): void {
  const level = ctx.level;
  seedBlob(
    level.blobs,
    'paralytic',
    cell,
    80 + 5 * level.depth,
    level.w * level.h,
  );
}

/** PoisonTrap.trigger (PoisonTrap.java:34). */
function poisonTrap(ctx: ActionContext, ch: TrapChar | null): void {
  if (ch !== null) {
    // Buff.affect(ch, Poison.class).set(durationFactor(ch) * (4 + depth/2)).
    // set() REPLACES the duration (Poison.java:52-54). durationFactor = 1:
    // no Resistance buff in M1 (Poison.java:84-87); the (4 + depth/2)
    // factor lives in buffs.ts poisonTrapDuration.
    ch.buffs.poison = { kind: 'poison', left: poisonTrapDuration(ctx.level.depth) };
  }
  // CellEmitter poison splash — visual; the renderer owns it.
}

/** AlarmTrap.trigger (AlarmTrap.java). */
function alarmTrap(
  ctx: ActionContext,
  cell: number,
  ch: TrapChar | null,
  mobs: TrapMob[],
  visible: boolean,
): void {
  // for (Mob mob : Dungeon.level.mobs) if (mob != ch) mob.beckon(pos);
  for (const mob of mobs) {
    if (mob !== ch) {
      beckonMob(mob, cell);
    }
  }
  if (visible) {
    ctx.log(TXT_ALARM_SOUND); // GLog.w (AlarmTrap.java)
  }
  // Sample SND_ALERT — no audio seam in M1; the renderer owns SFX.
}

/** LightningTrap.trigger (LightningTrap.java). */
function lightningTrap(
  ctx: ActionContext,
  rng: MechanicsRng,
  cell: number,
  ch: TrapChar | null,
): void {
  if (ch !== null) {
    // ch.damage(max(1, Random.Int(HP/3, 2*HP/3)), LIGHTNING) — int division,
    // Int(min, max) = [min, max) (LightningTrap.java).
    const dmg = Math.max(
      1,
      rng.int(Math.floor(ch.hp / 3), Math.floor((2 * ch.hp) / 3)),
    );
    damageFromTrap(ctx, rng, ch, dmg, 'lightning', () => {
      // Dungeon.fail(...) is the engine's game over; the GLog line is exact.
      ctx.log(TXT_LIGHTNING_DEATH); // GLog.n (LightningTrap.java)
    });
    if (ch.kind === 'hero' && ch.isAlive()) {
      // Camera.main.shake(2, 0.3f) — visual; the renderer owns it.
      chargeHeroWands(ch);
    }
    // Lightning arcs + spark burst — visuals; the renderer owns them.
  } else {
    // CellEmitter spark burst still fires with ch == null — visual.
  }
  void cell;
}

/**
 * Vanilla Belongings.charge(false) (Belongings.java:200-217): every wand
 * with curCharges < maxCharges gains +1 charge. NOTE: this ADDS charges —
 * it does not discharge. M1 has no wands in the item catalog, so this is
 * a no-op until wands land (Stage 2 fills it in).
 */
function chargeHeroWands(_hero: TrapHero): number {
  return 0;
}

/** GrippingTrap.trigger (GrippingTrap.java). */
function grippingTrap(
  rng: MechanicsRng,
  ch: TrapChar | null,
  depth: number,
): void {
  if (ch !== null) {
    // damage = max(0, (depth + 3) - IntRange(0, dr()/2)) (int division).
    const damage = Math.max(
      0,
      depth + 3 - rng.intRange(0, Math.floor(trapCharDr(ch) / 2)),
    );
    // Buff.affect(c, Bleeding.class).set(damage) (Bleeding.set, Bleeding.java).
    ch.buffs.bleeding = { kind: 'bleeding', left: 0, level: damage };
    // Buff.prolong(c, Cripple.class, Cripple.DURATION) (Cripple.java:24).
    const cur = ch.buffs.cripple?.left ?? 0;
    ch.buffs.cripple = { kind: 'cripple', left: Math.max(cur, CRIPPLE_DURATION) };
    // Wound.hit(c) — visual; the renderer owns it.
  } else {
    // Wound.hit(pos) — visual.
  }
}

/**
 * Bestiary.mob(depth) target for SummoningTrap (SummoningTrap.java:80 —
 * the plain table, NOT mutable; the respawner owns mutation).
 * Tables: Bestiary.java mobClass, depths 1-4 (M1) and 6-9 (Stage 1).
 * Depth 5/10 are boss levels (early return — no summoning there).
 */
export function bestiaryMobId(
  rng: MechanicsRng,
  depth: number,
): string | null {
  let chances: readonly number[];
  let ids: readonly string[];
  switch (depth) {
    case 1:
      chances = [1];
      ids = ['rat'];
      break;
    case 2:
      chances = [1, 1];
      ids = ['rat', 'gnoll'];
      break;
    case 3:
      chances = [1, 2, 1, 0.02];
      ids = ['rat', 'gnoll', 'crab', 'swarm'];
      break;
    case 4:
      chances = [1, 2, 3, 0.02, 0.01, 0.01];
      ids = ['rat', 'gnoll', 'crab', 'swarm', 'skeleton', 'thief'];
      break;
    case 6:
      chances = [4, 2, 1, 0.2];
      ids = ['skeleton', 'thief', 'swarm', 'shaman'];
      break;
    case 7:
      chances = [3, 1, 1, 1];
      ids = ['skeleton', 'shaman', 'thief', 'swarm'];
      break;
    case 8:
      chances = [3, 2, 1, 1, 1, 0.02];
      ids = ['skeleton', 'shaman', 'gnoll', 'thief', 'swarm', 'bat'];
      break;
    case 9:
      chances = [3, 3, 1, 1, 0.02, 0.01];
      ids = ['skeleton', 'shaman', 'thief', 'swarm', 'bat', 'brute'];
      break;
    default:
      return null; // boss depths 5/10 + future regions: no summoning table.
  }
  // Vanilla Random.chances(float[]): value = Float(sum); first i with
  // value < cumsum (watabou Random.java).
  let sum = 0;
  for (const c of chances) sum += Math.max(0, c);
  if (sum <= 0) return null;
  const value = rng.float(0, sum);
  sum = 0;
  for (let i = 0; i < chances.length; i++) {
    sum += Math.max(0, chances[i]);
    if (value < sum) return ids[i];
  }
  return null;
}

/** SummoningTrap.trigger (SummoningTrap.java). */
function summoningTrap(
  ctx: ActionContext,
  rng: MechanicsRng,
  cell: number,
  ch: TrapChar | null,
  hero: TrapHero,
  mobs: TrapMob[],
  summon: TrapSummoner,
): void {
  const level = ctx.level;

  // if (Dungeon.bossLevel()) return; — the trap still deactivates (press()
  // continues after trigger returns).
  if (level.bossLevel) {
    return;
  }

  // Actor.occupyCell(c): the triggerer's cell counts as occupied, so no mob
  // spawns there — the candidate filter below (findChar == null) covers it.
  void ch;

  // 1 + (Int(2)==0 ? 1 + (Int(2)==0 ? 1 : 0) : 0)  -> 1..3 mobs.
  let nMobs = 1;
  if (rng.int(0, 2) === 0) {
    nMobs++;
    if (rng.int(0, 2) === 0) {
      nMobs++;
    }
  }

  // Candidates: 8 neighbours with no char and (passable || avoid).
  const { x, y } = level.xy(cell);
  const candidates: number[] = [];
  for (const n of level.neighbors8(x, y)) {
    const p = level.idx(n.x, n.y);
    const occupied =
      (hero.isAlive() && hero.pos === p) ||
      mobs.some((m) => m.isAlive() && m.pos === p);
    if (!occupied && (level.isPassable(n.x, n.y) || level.isAvoid(n.x, n.y))) {
      candidates.push(p);
    }
  }

  // DUMMY occupyCell dance: each pick removes the cell from candidates, so
  // no cell is picked twice (Random.index = Int(size)).
  const points: number[] = [];
  while (nMobs > 0 && candidates.length > 0) {
    const index = rng.int(0, candidates.length);
    points.push(candidates.splice(index, 1)[0]);
    nMobs--;
  }

  for (const point of points) {
    const mobId = bestiaryMobId(rng, level.depth);
    if (mobId === null) continue;
    // mob.state = WANDERING; GameScene.add(mob, DELAY=2);
    // WandOfBlink.appear(mob, point) — the appear flash is visual.
    summon(mobId, point);
  }
}

/* ------------------------------------------------------------------ */
/* Trigger state machine (Level.press / Level.mobPress, trap portions) */
/* ------------------------------------------------------------------ */

function triggerTrap(
  ctx: ActionContext,
  rng: MechanicsRng,
  cell: number,
  kind: TrapKind,
  ch: TrapChar | null,
  hero: TrapHero,
  mobs: TrapMob[],
  summon: TrapSummoner,
): void {
  const visible = ctx.level.visible[cell] !== 0;
  switch (kind) {
    case 'toxic':
      toxicTrap(ctx, cell);
      break;
    case 'fire':
      fireTrap(ctx, cell);
      break;
    case 'paralytic':
      paralyticTrap(ctx, cell);
      break;
    case 'poison':
      poisonTrap(ctx, ch);
      break;
    case 'alarm':
      alarmTrap(ctx, cell, ch, mobs, visible);
      break;
    case 'lightning':
      lightningTrap(ctx, rng, cell, ch);
      break;
    case 'gripping':
      grippingTrap(rng, ch, ctx.level.depth);
      break;
    case 'summoning':
      summoningTrap(ctx, rng, cell, ch, hero, mobs, summon);
      break;
  }
}

function deactivateTrapCell(level: Level, cell: number): void {
  const { x, y } = level.xy(cell);
  level.set(x, y, Terrain.TRAP_INACTIVE);
  // GameScene.updateMap(cell): tile art refresh — the renderer owns it.
}

/**
 * Vanilla Level.press(cell, ch), trap portion (Level.java:619-721).
 * The hero's (and any forced-movement char's) step: hidden AND revealed
 * traps fire. Single-use: the tile becomes INACTIVE_TRAP.
 *
 * NOTE: vanilla press() also handles pits, high grass, wells, alchemy and
 * doors — those belong to other workers/stages and are intentionally not
 * handled here.
 */
export function pressTrapCell(
  ctx: ActionContext,
  cell: number,
  ch: TrapChar | null,
  summon: TrapSummoner,
): void {
  const level = ctx.level;
  const tile = level.getAt(cell);
  const kind = trapKindOf(tile);
  if (kind === null) {
    return;
  }

  // case SECRET_*: GLog.i(TXT_HIDDEN_PLATE_CLICKS) — fires for ANY char
  // stepping on a hidden trap (Level.java fall-through cases).
  if (isHiddenTrap(tile)) {
    ctx.log(TXT_HIDDEN_PLATE_CLICKS);
  }

  const hero = ctx.hero as unknown as TrapHero;
  const mobs = ctx.mobs as unknown as TrapMob[];
  triggerTrap(ctx, ctx.rng, cell, kind, ch, hero, mobs, summon);

  // if (trap): SND_TRAP (no audio seam in M1 — renderer owns SFX);
  // if (ch == Dungeon.hero) hero.interrupt() (Hero.java:473-478): clears
  // curAction. M1 drives one intent per step with no action queue
  // (the tap-to-move path is engine-owned), so there is nothing to clear.
  deactivateTrapCell(level, cell);

  // Plant activation (Level.java:718-721): no plants in M1 — skip.
}

/**
 * Vanilla Level.mobPress(mob), trap portion (Level.java:723-775).
 * Mobs trigger ONLY revealed traps (no SECRET_* cases exist in mobPress).
 * Single-use: the tile becomes INACTIVE_TRAP.
 *
 * CALLER CONTRACT (Mob.move, Mob.java:259-263): the caller guards flying
 * mobs (`if (!flying) mobPress(this)`) — this function keeps vanilla's
 * shape and does not re-check.
 */
export function mobPressTrapCell(
  ctx: ActionContext,
  mob: TrapMob,
  summon: TrapSummoner,
): void {
  const level = ctx.level;
  const cell = mob.pos;
  const tile = level.getAt(cell);
  const kind = trapKindOf(tile);
  if (kind === null || isHiddenTrap(tile)) {
    return;
  }

  const hero = ctx.hero as unknown as TrapHero;
  const mobs = ctx.mobs as unknown as TrapMob[];
  triggerTrap(ctx, ctx.rng, cell, kind, mob, hero, mobs, summon);

  // if (Dungeon.visible[cell]) SND_TRAP — no audio seam in M1; renderer owns SFX.
  deactivateTrapCell(level, cell);

  // Plant activation: no plants in M1 — skip.
}

/** Bleeding tick applier for the buff engine (Bleeding.act, Bleeding.java). */
export function tickBleeding(
  ctx: ActionContext,
  rng: MechanicsRng,
  ch: TrapChar,
): void {
  const b = ch.buffs.bleeding;
  if (!b || !ch.isAlive()) {
    if (b) delete ch.buffs.bleeding;
    return;
  }
  const t = bleedingTick(rng, b.level ?? 0);
  if (t.detached) {
    delete ch.buffs.bleeding;
    return;
  }
  b.level = t.level;
  damageFromTrap(ctx, rng, ch, t.level, 'bleeding', () => {
    ctx.log(TXT_BLEEDING_DEATH); // GLog.n (Bleeding.java:70)
  });
  // Splash.at(blood) — visual; the renderer owns it.
}

/** Cripple tick: flavour countdown (FlavourBuff has no act of its own). */
export function tickCripple(ch: TrapChar): void {
  const b = ch.buffs.cripple;
  if (!b) return;
  b.left -= 1;
  if (b.left <= 0) {
    delete ch.buffs.cripple;
  }
}
