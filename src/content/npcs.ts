/**
 * Quest NPCs: the sad ghost, the old wandmaker, and the quest-spawned mobs
 * (fetid rat, curse personification) — faithful ports of vanilla
 * `actors/mobs/npcs/Ghost.java`, `actors/mobs/npcs/Wandmaker.java`,
 * `actors/mobs/npcs/NPC.java`, `actors/mobs/FetidRat.java`,
 * `actors/mobs/CursePersonification.java`, `items/quest/RatSkull.java`,
 * `items/quest/DriedRose.java`, and the dialog windows `windows/WndQuest.java`
 * (WndQuest.java:29-79), `windows/WndSadGhost.java` (WndSadGhost.java:30-67),
 * `windows/WndWandmaker.java` (WndWandmaker.java:34-76).
 * GPL-3.0, (C) Oleg Dolya.
 *
 * Vanilla Ghost.Quest / Wandmaker.Quest / Blacksmith.Quest are static
 * (run-level) quest state; here they are module singletons, reset per run by
 * `resetQuestState()` (called from the content layer's spawnHero) and
 * persisted across save/load by `saveQuestState()` / `restoreQuestState()`
 * (wired into src/engine/save.ts — vanilla Dungeon.storeInBundle calls
 * Ghost.Quest.storeInBundle / Wandmaker.Quest.storeInBundle /
 * Blacksmith.Quest.storeInBundle). Full quest journals are a
 * later milestone — Journal.add/remove are no-ops (documented below).
 *
 * Shared NPC contract (seams.ts): talkable NPCs expose `onTalk(ctx)`; the
 * engine's talk routing invokes it for the NPC on the clicked cell.
 *
 * STAGE 1 SCOPE NOTES (faithful where the systems exist; flagged gaps):
 * - DriedRose in this source version is a plain unique quest item
 *   (DriedRose.java:24-45) — it does NOT summon the ghost (later
 *   Shattered-style behavior). No summon mechanic is invented.
 * - Wandmaker wand rewards: the ten wand classes (WandOfAvalanche etc.) are
 *   the items worker's Stage-1/2 system. The quest draws and stores the
 *   exact wand identities (wand1/wand2) and the reward dialog offers the
 *   exact choices; granting maps to the current catalog placeholder until
 *   the wand classes land (see grantWandReward).
 * - Rotberry planting (Wandmaker.placeItem berry): the plant system is not
 *   ported yet, so the seed drops as a floor pickup instead of a planted
 *   shrub — flagged, not silent.
 * - CorpseDust placement prefers unseen SKELETON heaps (Wandmaker.java);
 *   the port has no heap-type metadata, so it drops at a random respawn
 *   cell — flagged.
 * - Ghost.relocate's CellEmitter speck burst and the curse-spawn shadow
 *   burst / SND_GHOST are visual/audio effects owned by the UI layer and
 *   are not simulated here.
 */
import type { RNG } from '../core/rng.js';
import { Terrain } from '../core/grid.js';
import type { ActionContext } from '../engine/seams.js';
import {
  ContentMob,
  charAtPos,
  dropItemAt,
  heroOf,
  killMob,
  registerNpcBuilder,
  registerSewersKillHook,
  type MobDef,
} from './mobs.js';
import {
  addToInventory,
  removeFromInventory,
  ContentHero,
} from './hero.js';
import { getItem } from './items.js';
import { itemGenerator } from './itemgen.js';
// Stage 2 (wands worker): real Wandmaker wand rewards (Wandmaker.java).
import {
  createWandReward,
  getWandState,
  identifyWandType,
  instanceItemDef,
  parseWandId,
} from './wands.js';
import { mobPressTrapCell, pressTrapCell, type TrapMob } from '../mechanics/traps.js';
import { upgradeItem, type DurableItem } from '../mechanics/durability.js';
import { tickHeroClock } from './actions.js';
import { showDialog, uiBridge } from '../ui/dialog.js';
import { Shopkeeper } from './shopkeeper.js';
import type { Game } from '../engine/loop.js';
// Stage 3 (Worker E): the Imp quest's heirloom-ring reward is a real ring
// instance (Imp.java:226-231), drawn from the ring system at quest spawn.
import { RING_SPECS, createRing, getRingState, identifyRingType } from './rings.js';

// ---------------------------------------------------------------------------
// Quest state (vanilla Ghost.Quest / Wandmaker.Quest statics)
// ---------------------------------------------------------------------------

/** Vanilla Ghost.Quest.Type (Ghost.java). */
export type GhostQuestType = 'rose' | 'rat' | 'curse';

export interface GhostQuestState {
  /** Vanilla Quest.spawned (Ghost.java:233-296). */
  spawned: boolean;
  type: GhostQuestType | null;
  given: boolean;
  processed: boolean;
  depth: number;
  /** Vanilla Quest.left2kill (Ghost.java:299-320). */
  left2kill: number;
  /** Vanilla Quest.weapon / Quest.armor: best-of-four draws, identified. */
  weaponId: string | null;
  armorId: string | null;
}

export function freshGhostQuest(): GhostQuestState {
  return {
    spawned: false,
    type: null,
    given: false,
    processed: false,
    depth: 0,
    left2kill: 8,
    weaponId: null,
    armorId: null,
  };
}

export const ghostQuest: GhostQuestState = freshGhostQuest();

/** Vanilla Wandmaker.Quest.Type (Wandmaker.java). */
export type WandmakerQuestType = 'berry' | 'dust' | 'fish';

export interface WandmakerQuestState {
  /** Vanilla Quest.spawned (Wandmaker.java:155-230). */
  spawned: boolean;
  type: WandmakerQuestType | null;
  given: boolean;
  /**
   * The two reward wand INSTANCE ids rolled at quest spawn
   * (Wandmaker.java:203-230: each choice is `new XxxWand().random().upgrade()`
   * at spawn, not at selection). Stored as instance ids
   * (`wand_of_avalanche#3`) so the exact spawn roll (level, charges)
   * survives until the hero chooses. Quest.complete() clears both.
   */
  wand1: string | null;
  wand2: string | null;
}

export function freshWandmakerQuest(): WandmakerQuestState {
  return { spawned: false, type: null, given: false, wand1: null, wand2: null };
}

export const wandmakerQuest: WandmakerQuestState = freshWandmakerQuest();

/** Reset all quest singletons for a fresh run (called from spawnHero). */
export function resetQuestState(): void {
  Object.assign(ghostQuest, freshGhostQuest());
  Object.assign(wandmakerQuest, freshWandmakerQuest());
  Object.assign(blacksmithQuest, freshBlacksmithQuest());
  Object.assign(impQuest, freshImpQuest());
}

/**
 * Vanilla Blacksmith.Quest statics (Blacksmith.java:251-265): the
 * blacksmith's reforge/imbue quest state. The NPC dialog/reforge logic is
 * the Stage-2 blacksmith worker's system; this file owns the run-level
 * quest state storage only (spawned/alternative/given/completed/reforged —
 * Blacksmith.java:267-300 storeInBundle/restoreFromBundle).
 */
export interface BlacksmithQuestState {
  /** Vanilla Quest.spawned (Blacksmith.java:253). */
  spawned: boolean;
  /**
   * Vanilla Quest.alternative (Blacksmith.java:255,315): the quest variant
   * drawn at spawn — false = mine dark gold ore with the pickaxe
   * (TXT_GOLD_1), true = stain the pickaxe with bat blood (TXT_BLOOD_1).
   */
  alternative: boolean;
  /** Vanilla Quest.given (Blacksmith.java:256). */
  given: boolean;
  /** Vanilla Quest.completed (Blacksmith.java:257). */
  completed: boolean;
  /** Vanilla Quest.reforged (Blacksmith.java:258). */
  reforged: boolean;
}

export function freshBlacksmithQuest(): BlacksmithQuestState {
  return {
    spawned: false,
    alternative: false,
    given: false,
    completed: false,
    reforged: false,
  };
}

export const blacksmithQuest: BlacksmithQuestState = freshBlacksmithQuest();

/**
 * Vanilla Imp.Quest statics (Imp.java:158-248): the ambitious imp's bounty
 * quest on the City depths. `alternative` picks the quest variant at spawn
 * (Imp.java:223): false = kill 6 golems (TXT_GOLEMS1), true = kill 8 monks
 * (TXT_MONKS1). `reward` is the heirloom ring instance rolled at spawn
 * (Imp.java:226-231), cleared on turn-in (Imp.Quest.complete).
 */
export interface ImpQuestState {
  /** Vanilla Quest.spawned (Imp.java:163). */
  spawned: boolean;
  /** Vanilla Quest.alternative (Imp.java:161): monks variant when true. */
  alternative: boolean;
  /** Vanilla Quest.given (Imp.java:164). */
  given: boolean;
  /** Vanilla Quest.completed (Imp.java:165). */
  completed: boolean;
  /**
   * The reward ring INSTANCE id rolled at quest spawn (Imp.java:226-231:
   * random non-cursed ring, upgrade(2), then cursed=true). Stored like the
   * wandmaker's wand instances (`ring_of_power#3`) so the exact roll
   * survives until turn-in. Quest.complete() clears it (Imp.java:240-245).
   */
  rewardRingId: string | null;
}

export function freshImpQuest(): ImpQuestState {
  return {
    spawned: false,
    alternative: false,
    given: false,
    completed: false,
    rewardRingId: null,
  };
}

export const impQuest: ImpQuestState = freshImpQuest();

/**
 * Save-bundle form of the run-level quest singletons (vanilla
 * Dungeon.storeInBundle -> Ghost.Quest.storeInBundle (Ghost.java:194-216),
 * Wandmaker.Quest.storeInBundle (Wandmaker.java:143-160),
 * Blacksmith.Quest.storeInBundle (Blacksmith.java:275-290),
 * Imp.Quest.storeInBundle (Imp.java:179-194)).
 * JSON-serializable; restored with restoreQuestState().
 */
export interface QuestSaveData {
  ghost: GhostQuestState;
  wandmaker: WandmakerQuestState;
  blacksmith: BlacksmithQuestState;
  imp: ImpQuestState;
}

/** Snapshot the quest singletons for the save bundle. */
export function saveQuestState(): QuestSaveData {
  return {
    ghost: { ...ghostQuest },
    wandmaker: { ...wandmakerQuest },
    blacksmith: { ...blacksmithQuest },
    imp: { ...impQuest },
  };
}

/**
 * Restore the quest singletons from a save bundle. Missing sections (old
 * saves) fall back to fresh state — vanilla restoreFromBundle leaves the
 * statics at reset() defaults when the node is absent.
 */
export function restoreQuestState(data: QuestSaveData | undefined): void {
  Object.assign(ghostQuest, freshGhostQuest(), data?.ghost ?? {});
  Object.assign(wandmakerQuest, freshWandmakerQuest(), data?.wandmaker ?? {});
  Object.assign(blacksmithQuest, freshBlacksmithQuest(), data?.blacksmith ?? {});
  Object.assign(impQuest, freshImpQuest(), data?.imp ?? {});
}

/**
 * Vanilla Ghost.Quest.spawn quest setup (Ghost.java:241-296): pick the quest
 * type, draw the best-of-four weapon and armor. The generator owns the
 * spawn chance/position; this owns the quest state.
 */
export function initGhostQuest(rng: RNG, depth: number): void {
  ghostQuest.spawned = true;
  const t = rng.int(0, 3);
  ghostQuest.type = t === 0 ? 'rose' : t === 1 ? 'rat' : 'curse';
  if (ghostQuest.type === 'rose') ghostQuest.left2kill = 8;
  ghostQuest.given = false;
  ghostQuest.processed = false;
  ghostQuest.depth = depth;

  // Best of four non-missile weapons by level (Ghost.java:268-277). M1
  // catalog weapons are all level 0 (no Weapon.random() level rolls), so the
  // strictly-greater comparison keeps the first draw — the loop is kept
  // structurally faithful for when the catalog grows.
  let weaponId = '';
  for (let i = 0; i < 4; i++) {
    let id = itemGenerator.randomFrom(rng, 'weapon', depth);
    while (getItem(id).weapon?.missile === true) {
      id = itemGenerator.randomFrom(rng, 'weapon', depth);
    }
    if (weaponId === '') weaponId = id; // all level 0: first draw wins
  }
  ghostQuest.weaponId = weaponId;

  // Best of four armors by level (Ghost.java:279-289). The NO_ARMOR
  // challenge does not exist in this port's Stage 1, so the challenge
  // branch is skipped (documented).
  let armorId = '';
  for (let i = 0; i < 4; i++) {
    const id = itemGenerator.randomFrom(rng, 'armor', depth);
    if (armorId === '') armorId = id; // all level 0: first draw wins
  }
  ghostQuest.armorId = armorId;
  // identify(): the port has no identification system (auto-identified).
}

/**
 * Vanilla Wandmaker.Quest.spawn quest setup (Wandmaker.java:183-231): pick
 * the quest type and draw the two wands. The generator owns the spawn
 * chance/position; this owns the quest state. `waterCells` is the level's
 * water tile count (vanilla counts Level.water, Wandmaker.java:193-203).
 */
export function initWandmakerQuest(rng: RNG, waterCells: number, levelLength: number): void {
  wandmakerQuest.spawned = true;
  const t = rng.int(0, 3);
  let type: WandmakerQuestType = t === 0 ? 'berry' : t === 1 ? 'dust' : 'fish';
  if (type === 'fish' && waterCells > levelLength / 16) {
    type = rng.int(0, 2) === 0 ? 'berry' : 'dust'; // Wandmaker.java:193-203
  }
  wandmakerQuest.type = type;
  wandmakerQuest.given = false;

  // wand1: battle wand, wand2: non-battle wand (Wandmaker.java:205-230).
  // Each choice is random().upgrade() AT SPAWN: the level/charge roll is
  // made now via createWandReward and the instance id is stored, so the
  // hero receives the exact wand that was drawn (not a re-roll at pickup).
  const battle = ['avalanche', 'disintegration', 'firebolt', 'lightning', 'poison'];
  const nonBattle = ['amok', 'blink', 'regrowth', 'slowness', 'reach'];
  wandmakerQuest.wand1 = createWandReward(rng, rng.pick(battle));
  wandmakerQuest.wand2 = createWandReward(rng, rng.pick(nonBattle));
}

/**
 * Vanilla Imp.Quest.spawn (Imp.java:212-232): once per run, drawn at City
 * depths. The generator calls this when the roll succeeds; the imp variant
 * and the heirloom ring are fixed here.
 *
 * - `alternative = Random.Int(2) == 0` (Imp.java:223): true = monks (8
 *   tokens), false = golems (6 tokens).
 * - The reward (Imp.java:226-231): `do { reward = Generator.random(RING); }
 *   while (reward.cursed); reward.upgrade(2); reward.cursed = true;`
 *   Generator's ring probs are uniform 1s over the first 10 ring classes
 *   (Generator.java:164-177, haggler/thorns prob 0), and each drawn ring
 *   runs Ring.random() (lvl = IntRange(1,3), 30% degraded+cursed —
 *   Ring.java:306-315). The reroll-until-uncursed loop plus upgrade(2)
 *   makes the final ring: uniform type, level = IntRange(1,3)+2, cursed.
 */
export function initImpQuest(rng: RNG): void {
  impQuest.spawned = true;
  impQuest.alternative = rng.int(0, 2) === 0;
  impQuest.given = false;

  // Generator RING bag (Generator.java:164-177): prob 1 for Accuracy,
  // Evasion, Haste, Satiety, Mending, Detection, Shadows, Power, Herbalism,
  // Elements; prob 0 for Haggler and Thorns (the port's haggler/thorns
  // have price 0, never generated — mechanics/rings.ts).
  const generatable = RING_SPECS.filter(
    (s) => s.id !== 'haggler' && s.id !== 'thorns',
  ).map((s) => s.id);
  let ringId = rng.pick(generatable);
  // Ring.random() curse roll (Ring.java:306-315): 30% degraded+cursed.
  // Vanilla re-rolls the whole ring until it is NOT cursed.
  while (rng.float(0, 1) < 0.3) {
    ringId = rng.pick(generatable);
  }
  const instanceId = createRing(rng, ringId);
  const st = getRingState(instanceId);
  if (st) {
    // reward.upgrade(2) (Item.upgrade: level += 2), then cursed = true
    // (Imp.java:228-231).
    st.level = rng.intRange(1, 3) + 2;
    st.cursed = true;
  }
  impQuest.rewardRingId = instanceId;
}

/**
 * Vanilla Imp.Quest.spawn's placement gate (Imp.java:213, called from
 * CityLevel.decorate — CityLevel.java:91): once per run, on depths > 16
 * (CityLevel depths 17-19), with chance 1/(20-depth) per depth — so the imp
 * always appears by depth 19 (Random.Int(1) == 0).
 */
export function rollImpSpawn(rng: RNG, depth: number): boolean {
  return !impQuest.spawned && depth > 16 && rng.int(0, 20 - depth) === 0;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Vanilla Level.randomRespawnCell() (Level.java:386-391): random passable,
 * unseen, unoccupied cell, 100 tries, else -1.
 */
export function randomRespawnCell(ctx: ActionContext): number {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0; i < 100; i++) {
    const pos = ctx.rng.int(0, n);
    const x = pos % level.w;
    const y = Math.floor(pos / level.w);
    if (!level.isPassable(x, y)) continue;
    if (level.visible[pos] !== 0) continue;
    if (charAtPos(ctx, pos) != null) continue;
    return pos;
  }
  return -1;
}

/** Inventory slot holding the quest item, or -1. */
function questItemSlot(hero: ContentHero, itemId: string): number {
  return hero.inventory.findIndex((s) => s.itemId === itemId);
}

/**
 * Vanilla Dungeon.hero.className() (Hero.java:233-235: heroClass.title()).
 * Stage 1 ships only the warrior (HeroClass.WARRIOR title "warrior",
 * HeroClass.java:41).
 */
function heroClassName(): string {
  return 'warrior';
}

/**
 * Vanilla Char.java Utils.format(TXT_..., ...) with %s — the port's texts
 * keep the %s placeholder; this fills it.
 */
function fillClassName(text: string): string {
  return text.replace('%s', heroClassName());
}

// ---------------------------------------------------------------------------
// NPC base
// ---------------------------------------------------------------------------

function npcDef(
  id: string,
  name: string,
  sprite: string,
  speed: number,
  flying: boolean,
): MobDef {
  return {
    id,
    name,
    sprite,
    hp: 1,
    def: 1000, // NPC defenseSkill (NPC.java:33-37 — effectively unhittable)
    atk: 1,
    dmgMin: 1,
    dmgMax: 2,
    triangular: true,
    dr: 0,
    speed,
    flying,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: [],
    exp: 0, // NPC EXP = 0 (NPC.java)
    maxLvl: 0,
  };
}

/**
 * Vanilla NPC (NPC.java:25-53): HP=HT=1, EXP=0, non-hostile, passive, throws
 * items off its own tile each turn (throwItem, NPC.java:39-48), ignores
 * beckon (NPC.java:50-52), and damage()/add(Buff) are no-ops — the port's
 * `invulnerable` flag (honored at the damage/buff choke points).
 */
export class NpcMob extends ContentMob {
  constructor(id: number, def: MobDef, pos: number, w: number) {
    super(id, def, pos, w);
    this.invulnerable = true;
    this.hostile = false;
  }

  /**
   * Shared NPC contract (engine/seams.ts MobActor.onTalk): clicking/tapping
   * a talkable NPC routes here. Vanilla NPC.interact() — subclasses
   * implement the dialog flows.
   */
  onTalk(_ctx: ActionContext): void {
    // Subclasses override.
  }

  override takeTurn(ctx: ActionContext): number {
    this.throwItem(ctx);
    return super.takeTurn(ctx);
  }

  /**
   * Vanilla NPC.throwItem() (NPC.java:39-48): if an item lies on the NPC's
   * tile, move one item to a random passable-or-avoid 8-neighbor. The port
   * tries 8 random neighbors (vanilla's do/while has no bound; the bound
   * prevents a pathological infinite loop and is unreachable in practice).
   */
  protected throwItem(ctx: ActionContext): void {
    const level = ctx.level;
    const idx = level.items.findIndex((it) => it.pos === this.pos);
    if (idx === -1) return;
    const dirs = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1],
    ];
    ctx.rng.shuffle(dirs);
    for (const [dx, dy] of dirs) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      // Level.avoid has no port equivalent yet; isPassable covers it.
      if (level.isPassable(nx, ny)) {
        const [item] = level.items.splice(idx, 1);
        level.items.push({ ...item, pos: ny * level.w + nx });
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sad ghost
// ---------------------------------------------------------------------------

const TXT_ROSE1 =
  'Hello adventurer... Once I was like you - strong and confident... ' +
  "And now I'm dead... But I can't leave this place... Not until I have my _dried rose_... " +
  "It's very important to me... Some monster stole it from my body...";
const TXT_ROSE2 = 'Please... Help me... _Find the rose_...';
const TXT_ROSE3 =
  'Yes! Yes!!! This is it! Please give it to me! ' +
  'And you can take one of these items, maybe they ' +
  'will be useful to you in your journey...';
const TXT_RAT1 =
  'Hello adventurer... Once I was like you - strong and confident... ' +
  "And now I'm dead... But I can't leave this place... Not until I have my revenge... " +
  'Slay the _fetid rat_, that has taken my life...';
const TXT_RAT2 = 'Please... Help me... _Slay the abomination_...';
const TXT_RAT3 =
  'Yes! The ugly creature is slain and I can finally rest... ' +
  'Please take one of these items, maybe they ' +
  'will be useful to you in your journey...';
const TXT_CURSE1 =
  'Hello adventurer... Once I was like you - strong and confident... ' +
  "And now I'm dead... But I can't leave this place, as I am bound by a horrid curse... " +
  'Please... Help me... _Destroy the curse_...';
const TXT_CURSE2 =
  'Thank you, %s! The curse is broken and I can finally rest... ' +
  'Please take one of these items, maybe they ' +
  'will be useful to you in your journey...';
const TXT_CURSE_YES = 'Yes, I will do it for you';
const TXT_CURSE_NO = "No, I can't help you";
const TXT_FAREWELL_GHOST = 'The sad ghost yells: Farewell, adventurer!';

// Vanilla WndSadGhost (WndSadGhost.java:30-67): title "Sad ghost",
// reward choice labels.
const TXT_WEAPON = "Ghost's weapon";
const TXT_ARMOR = "Ghost's armor";

/**
 * Vanilla Ghost (Ghost.java:48-105): name "sad ghost", flying, wandering,
 * speed 0.5, defenseSkill 1000, cannot be damaged or buffed (damage()/add()
 * no-ops, Ghost.java:96-104), chooses no enemy (chooseEnemy null,
 * Ghost.java:77-85).
 */
export class GhostMob extends NpcMob {
  constructor(id: number, pos: number, w: number) {
    super(
      id,
      npcDef('ghost', 'sad ghost', 'mob_ghost', 0.5, true),
      pos,
      w,
    );
    this.state = 'wandering'; // Ghost.java: ghost wanders (not passive)
  }

  /** Vanilla Ghost.chooseEnemy() (Ghost.java:77-85): no enemy, ever. */
  protected override selectEnemy(_ctx: ActionContext): ContentHero | null {
    return null;
  }

  /**
   * Vanilla Ghost.interact() (Ghost.java:107-126): routes to the quest
   * handler for the run's quest type (rose/rat/curse).
   */
  override onTalk(ctx: ActionContext): void {
    const type = ghostQuest.type ?? 'rose';
    if (type === 'rose') void this.roseInteract(ctx);
    else if (type === 'rat') void this.ratInteract(ctx);
    else void this.curseInteract(ctx);
  }

  private async roseInteract(ctx: ActionContext): Promise<void> {
    const hero = heroOf(ctx);
    if (ghostQuest.given) {
      const slot = questItemSlot(hero, 'dried_rose');
      if (slot !== -1) {
        await showDialog({
          title: 'Sad ghost',
          sprite: this.sprite,
          text: TXT_ROSE3,
          choices: [
            { label: TXT_WEAPON, value: 'weapon' },
            { label: TXT_ARMOR, value: 'armor' },
          ],
        }).then((v) => grantGhostReward(ctx, this, 'dried_rose', v));
      } else {
        await showDialog({ title: 'Sad ghost', sprite: this.sprite, text: TXT_ROSE2, choices: [] });
        relocateGhost(ctx, this);
      }
    } else {
      await showDialog({ title: 'Sad ghost', sprite: this.sprite, text: TXT_ROSE1, choices: [] });
      ghostQuest.given = true;
      // Journal.add( Journal.Feature.GHOST ): no journal in Stage 1.
    }
  }

  private async ratInteract(ctx: ActionContext): Promise<void> {
    const hero = heroOf(ctx);
    if (ghostQuest.given) {
      const slot = questItemSlot(hero, 'rat_skull');
      if (slot !== -1) {
        await showDialog({
          title: 'Sad ghost',
          sprite: this.sprite,
          text: TXT_RAT3,
          choices: [
            { label: TXT_WEAPON, value: 'weapon' },
            { label: TXT_ARMOR, value: 'armor' },
          ],
        }).then((v) => grantGhostReward(ctx, this, 'rat_skull', v));
      } else {
        await showDialog({ title: 'Sad ghost', sprite: this.sprite, text: TXT_RAT2, choices: [] });
        relocateGhost(ctx, this);
      }
    } else {
      await showDialog({ title: 'Sad ghost', sprite: this.sprite, text: TXT_RAT1, choices: [] });
      ghostQuest.given = true;
      // Journal.add( Journal.Feature.GHOST ): no journal in Stage 1.
    }
  }

  private async curseInteract(ctx: ActionContext): Promise<void> {
    if (ghostQuest.given) {
      // The curse personification is dead and replaced by this passive
      // ghost (CursePersonification.die, CursePersonification.java:92-96).
      await showDialog({
        title: 'Sad ghost',
        sprite: this.sprite,
        text: fillClassName(TXT_CURSE2),
        choices: [
          { label: TXT_WEAPON, value: 'weapon' },
          { label: TXT_ARMOR, value: 'armor' },
        ],
      }).then((v) => grantGhostReward(ctx, this, null, v));
      return;
    }
    // Vanilla shows the yes/no dialog and adds the journal entry when the
    // dialog is SHOWN (Ghost.java:448-459) — the entry fires even if the
    // player dismisses without choosing.
    // Journal.add( Journal.Feature.GHOST ): no journal in Stage 1.
    const choice = await showDialog({
      title: 'Sad ghost',
      sprite: this.sprite,
      text: TXT_CURSE1,
      choices: [
        { label: TXT_CURSE_YES, value: 'yes' },
        { label: TXT_CURSE_NO, value: 'no' },
      ],
    });
    if (choice === 'yes') {
      ghostQuest.given = true;
      // Ghost.replace(ghost, curse) (Ghost.java:128-145): the ghost vanishes
      // and the curse personification hunts the hero.
      const curse = new CurseMob(nextNpcId(), this.pos, this.w, ctx.level.depth);
      ctx.removeMob(this);
      ctx.addMob(curse, 0);
      // d.sprite.emitter().burst( ShadowParticle.CURSE, 5 ) +
      // Sample.INSTANCE.play( Assets.SND_GHOST ): UI-layer effects.
      // Dungeon.hero.next(): vanilla spends the hero's turn accepting the
      // quest (Ghost.java:441-442). The port's talk intent costs 0
      // (Hero.java:505-511); the 1-turn accept cost is a documented
      // micro-divergence kept for input responsiveness.
    } else if (choice === 'no') {
      relocateGhost(ctx, this);
    }
    // Dismissed (''): vanilla closed the window without onSelect — the
    // ghost stays, the player can talk again.
  }
}

/** Vanilla Ghost.QuestHandler.relocate() (Ghost.java:326-344). */
function relocateGhost(ctx: ActionContext, ghost: GhostMob): void {
  let newPos = -1;
  for (let i = 0; i < 10; i++) {
    newPos = randomRespawnCell(ctx);
    if (newPos !== -1) break;
  }
  if (newPos !== -1) {
    ghost.pos = newPos;
    ctx.syncMobs();
    // CellEmitter speck burst: UI-layer effect, not simulated.
  }
}

/**
 * Vanilla WndSadGhost.onSelect (WndSadGhost.java:49-64): detach the quest
 * item (if any), grant the chosen reward, the ghost yells farewell, dies,
 * and the quest completes.
 */
function grantGhostReward(
  ctx: ActionContext,
  ghost: GhostMob,
  questItemId: string | null,
  value: string,
): void {
  if (value !== 'weapon' && value !== 'armor') return; // dismissed: vanilla no-op
  const hero = heroOf(ctx);
  if (questItemId !== null) {
    const slot = questItemSlot(hero, questItemId);
    if (slot !== -1) removeFromInventory(hero, slot, 1);
  }
  const rewardId = value === 'weapon' ? ghostQuest.weaponId : ghostQuest.armorId;
  if (rewardId) {
    // Vanilla: doPickUp into the pack, else drop at the ghost's position.
    // The port's pack is unbounded (M1), so the drop fallback is unreachable.
    addToInventory(hero, rewardId, 1);
    ctx.log(`You now have the ${getItem(rewardId).name}.`); // Hero.TXT_YOU_NOW_HAVE
  }
  ctx.log(TXT_FAREWELL_GHOST); // Ghost.TXT_FAREWELL
  killMob(ctx, ghost, {}); // ghost.die(null): EXP 0, no loot
  // Vanilla Quest.complete(): weapon/armor = null, journal removed.
  ghostQuest.weaponId = null;
  ghostQuest.armorId = null;
}

/**
 * Vanilla Ghost.Quest.processSewersKill (Ghost.java:299-320): called when
 * the hero kills a sewers mob (Rat.die Rat.java:54, Gnoll.die Gnoll.java:59,
 * Crab.die Crab.java:65).
 */
export function onSewersKill(ctx: ActionContext, pos: number): void {
  if (
    !ghostQuest.spawned ||
    !ghostQuest.given ||
    ghostQuest.processed ||
    ghostQuest.depth !== ctx.level.depth
  ) {
    return;
  }
  if (ghostQuest.type === 'rose') {
    if (ctx.rng.int(0, ghostQuest.left2kill) === 0) {
      dropItemAt(ctx, pos, 'dried_rose');
      ghostQuest.processed = true;
    } else {
      ghostQuest.left2kill--;
    }
  } else if (ghostQuest.type === 'rat') {
    const rat = new FetidRatMob(nextNpcId(), 0, ctx.level.w);
    rat.pos = randomRespawnCell(ctx);
    if (rat.pos !== -1) {
      ctx.addMob(rat, 0); // GameScene.add(rat): added immediately
      ghostQuest.processed = true;
    }
  }
  // CURSE: nothing (Ghost.java:299-320 default branch).
}

// ---------------------------------------------------------------------------
// Wandmaker
// ---------------------------------------------------------------------------

const TXT_BERRY1 =
  'Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient - ' +
  "a _Rotberry seed_. Being a magic user, I'm quite able to defend myself against local monsters, " +
  "but I'm getting lost in no time, it's very embarrassing. Probably you could help me? I would be " +
  'happy to pay for your service with one of my best wands.';
const TXT_BERRY2 = 'Any luck with a _Rotberry seed_, %s? No? Don\'t worry, I\'m not in a hurry.';
const TXT_DUST1 =
  'Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient - ' +
  '_corpse dust_. It can be gathered from skeletal remains and there is an ample number of them in the dungeon. ' +
  "Being a magic user, I'm quite able to defend myself against local monsters, but I'm getting lost in no time, " +
  "it's very embarrassing. Probably you could help me? I would be happy to pay for your service with one of my best wands.";
const TXT_DUST2 = 'Any luck with _corpse dust_, %s? Bone piles are the most obvious places to look.';
const TXT_FISH1 =
  'Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient: ' +
  "a _phantom fish_. You can catch it with your bare hands, but it's very hard to notice in the water. " +
  "Being a magic user, I'm quite able to defend myself against local monsters, but I'm getting lost in no time, " +
  "it's very embarrassing. Probably you could help me? I would be happy to pay for your service with one of my best wands.";
const TXT_FISH2 = 'Any luck with a _phantom fish_, %s? You may want to try searching for it in one of the local pools.';
const TXT_FAREWELL_WANDMAKER = 'Good luck in your quest, %s!';

// Vanilla WndWandmaker (WndWandmaker.java:34-76): title "Old wandmaker",
// reward choice labels.
const TXT_BATTLE = 'Battle wand';
const TXT_NON_BATTLE = 'Non-battle wand';

/**
 * Vanilla Wandmaker (Wandmaker.java:46-95): name "old wandmaker", passive,
 * defenseSkill 1000, cannot be damaged or buffed.
 */
export class WandmakerMob extends NpcMob {
  constructor(id: number, pos: number, w: number) {
    super(id, npcDef('wandmaker', 'old wandmaker', 'mob_wandmaker', 1, false), pos, w);
    this.state = 'passive';
  }

  /**
   * Vanilla QuestHandler.interact (Wandmaker.java:240-266): first talk tells
   * the task, sets given, places the quest item; later talks check for the
   * item (reminder) or open the reward dialog.
   */
  override onTalk(ctx: ActionContext): void {
    void this.interact(ctx);
  }

  private async interact(ctx: ActionContext): Promise<void> {
    const type = wandmakerQuest.type ?? 'berry';
    const texts =
      type === 'berry'
        ? { q1: TXT_BERRY1, q2: TXT_BERRY2, item: 'rotberry_seed' }
        : type === 'dust'
          ? { q1: TXT_DUST1, q2: TXT_DUST2, item: 'corpse_dust' }
          : { q1: TXT_FISH1, q2: TXT_FISH2, item: 'phantom_fish' };
    if (wandmakerQuest.given) {
      const slot = questItemSlot(heroOf(ctx), texts.item);
      if (slot !== -1) {
        await showDialog({
          title: 'Old wandmaker',
          sprite: this.sprite,
          text: fillClassName(
            type === 'berry' ? TXT_BERRY_REWARD : type === 'dust' ? TXT_DUST_REWARD : TXT_FISH_REWARD,
          ),
          choices: [
            { label: TXT_BATTLE, value: 'battle' },
            { label: TXT_NON_BATTLE, value: 'nonbattle' },
          ],
        }).then((v) => grantWandReward(ctx, this, texts.item, v));
      } else {
        await showDialog({
          title: 'Old wandmaker',
          sprite: this.sprite,
          text: fillClassName(texts.q2),
          choices: [],
        });
      }
    } else {
      await showDialog({ title: 'Old wandmaker', sprite: this.sprite, text: texts.q1, choices: [] });
      wandmakerQuest.given = true;
      placeWandmakerItem(ctx, type);
      // Journal.add( Journal.Feature.WANDMAKER ): no journal in Stage 1.
    }
  }
}

// Reward intro lines: vanilla WndWandmaker shows TXT_FAREWELL ("Good luck in
// your quest, %s!", WndWandmaker.java:40) as the dialog text with the two
// wand choices.
const TXT_BERRY_REWARD = TXT_FAREWELL_WANDMAKER;
const TXT_DUST_REWARD = TXT_FAREWELL_WANDMAKER;
const TXT_FISH_REWARD = TXT_FAREWELL_WANDMAKER;

/**
 * Vanilla WndWandmaker.onSelect (WndWandmaker.java:52-72): detach the quest
 * item, identify and grant the chosen wand (pack else drop at the
 * wandmaker), yell farewell, destroy the NPC, complete the quest.
 */
function grantWandReward(
  ctx: ActionContext,
  wandmaker: WandmakerMob,
  questItemId: string,
  value: string,
): void {
  if (value !== 'battle' && value !== 'nonbattle') return; // dismissed: vanilla no-op
  const hero = heroOf(ctx);
  const slot = questItemSlot(hero, questItemId);
  if (slot !== -1) removeFromInventory(hero, slot, 1);
  const rewardId = value === 'battle' ? wandmakerQuest.wand1 : wandmakerQuest.wand2;
  const grantId = resolveWandRewardInstance(ctx.rng, rewardId);
  if (grantId) {
    // WndWandmaker.onSelect: wand.identify() then doPickUp into the pack,
    // else drop at the wandmaker's tile. The port's pack is unbounded, so
    // the drop fallback is unreachable — kept as the vanilla comment.
    const parsed = parseWandId(grantId);
    if (parsed) identifyWandType(parsed.wandId, ctx.log);
    addToInventory(hero, grantId, 1);
    // The reward is an instance id; its def comes from the wand module.
    ctx.log(`You now have the ${instanceItemDef(grantId)?.name ?? grantId}.`); // Hero.TXT_YOU_NOW_HAVE
  }
  ctx.log(fillClassName('The old wandmaker yells: ' + TXT_FAREWELL_WANDMAKER));
  ctx.removeMob(wandmaker); // wandmaker.destroy(): silent, no death pipeline
  // Vanilla Quest.complete(): wand1/wand2 = null, journal removed.
  wandmakerQuest.wand1 = null;
  wandmakerQuest.wand2 = null;
}

/**
 * Resolve the stored reward instance id to a grantable id.
 * The instance state lives in the wand module; if it was lost (e.g. a
 * save/load round-trip before wand-state persistence is wired), re-roll
 * an equivalent reward from the wand id embedded in the instance id so
 * the quest never grants nothing.
 */
function resolveWandRewardInstance(
  rng: RNG,
  rewardId: string | null,
): string | null {
  if (rewardId === null) return null;
  if (getWandState(rewardId)) return rewardId;
  const parsed = parseWandId(rewardId);
  if (!parsed) return null;
  return createWandReward(rng, parsed.wandId);
}

/**
 * Legacy descriptor mapper (Stage-1 quest states stored 'wand_avalanche'
 * style descriptors). Maps them to wand ids; current quest states store
 * reward instance ids directly (see WandmakerQuestState).
 */
export function resolveWandReward(wandDesc: string | null): string | null {
  if (wandDesc === null) return null;
  if (wandDesc.startsWith('wand_of_') || wandDesc.includes('#')) return wandDesc;
  if (wandDesc.startsWith('wand_')) return wandDesc.slice('wand_'.length);
  return null;
}

/**
 * Vanilla QuestHandler.placeItem per quest type (Wandmaker.java:268-391).
 */
function placeWandmakerItem(ctx: ActionContext, type: WandmakerQuestType): void {
  if (type === 'berry') {
    // Dungeon.level.plant( new Rotberry.Seed(), shrubPos ): the plant
    // system is not ported yet, so the seed drops as a floor pickup at a
    // heap-free random respawn cell (flagged scope gap).
    let pos = randomRespawnCell(ctx);
    let guard = 0;
    while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
      pos = randomRespawnCell(ctx);
    }
    if (pos !== -1) dropItemAt(ctx, pos, 'rotberry_seed');
  } else if (type === 'dust') {
    // Prefers an unseen SKELETON heap; the port has no heap-type metadata,
    // so it always takes the fallback: a heap-free random respawn cell
    // (flagged scope gap).
    let pos = randomRespawnCell(ctx);
    let guard = 0;
    while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
      pos = randomRespawnCell(ctx);
    }
    if (pos !== -1) dropItemAt(ctx, pos, 'corpse_dust');
  } else {
    // Up to 100 random cells: hidden heap in water (Wandmaker.java:343-391).
    // The port has no hidden-heap flag; the fish drops visibly (flagged
    // scope gap — Heap.Type.HIDDEN arrives with the heap rework).
    const n = ctx.level.w * ctx.level.h;
    let placed = false;
    for (let i = 0; i < 100; i++) {
      const pos = ctx.rng.int(0, n);
      if (ctx.level.getAt(pos) === Terrain.WATER) {
        dropItemAt(ctx, pos, 'phantom_fish');
        placed = true;
        break;
      }
    }
    if (!placed) {
      let pos = randomRespawnCell(ctx);
      let guard = 0;
      while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
        pos = randomRespawnCell(ctx);
      }
      if (pos !== -1) dropItemAt(ctx, pos, 'phantom_fish');
    }
  }
}

// ---------------------------------------------------------------------------
// Fetid rat
// ---------------------------------------------------------------------------

/**
 * Vanilla FetidRat (FetidRat.java:32-88): HP 15, defense 5, attack 12,
 * damage 2-6 triangular, DR 2, EXP 3, maxLvl 5, wandering; each defenseProc
 * seeds 20 ParalyticGas at its cell (FetidRat.java:79-82); dies dropping a
 * RatSkull (FetidRat.java:85-88); immune to paralysis (FetidRat.java:41).
 * Spawned by the ghost's rat quest when the hero slays a sewers mob
 * (Ghost.Quest.processSewersKill).
 */
export class FetidRatMob extends ContentMob {
  constructor(id: number, pos: number, w: number) {
    super(
      id,
      {
        id: 'fetidrat',
        name: 'fetid rat',
        sprite: 'mob_fetidrat',
        hp: 15,
        def: 5,
        atk: 12,
        dmgMin: 2,
        dmgMax: 6,
        dr: 2,
        speed: 1,
        flying: false,
        attackDelay: 1,
        triangular: true, // damageRoll = NormalIntRange(2, 6) (FetidRat.java:72-74)
        ability: 'fetidrat',
        immunities: ['paralysis'],
        resistances: [],
        exp: 3,
        maxLvl: 5,
      },
      pos,
      w,
    );
    this.state = 'wandering'; // FetidRat.java instance init
  }

  /** FetidRat.die (FetidRat.java:85-88): drops the rat skull. */
  override onDeath(ctx: ActionContext): void {
    dropItemAt(ctx, this.pos, 'rat_skull');
  }
}

// ---------------------------------------------------------------------------
// Curse personification
// ---------------------------------------------------------------------------

/**
 * Vanilla CursePersonification (CursePersonification.java:36-116):
 * HP 10 + depth*3, defenseSkill 10 + depth, attackSkill 10 + depth, damage
 * 3-5 (NormalIntRange), DR 1, EXP 3, maxLvl 5, hunting, speed 0.5, flying;
 * pushes its target one cell away on attackProc when the cell is free
 * (CursePersonification.java:55-83); regenerates 1 HP/turn while injured
 * (act, CursePersonification.java:86-91); on death becomes a passive ghost
 * (die, CursePersonification.java:92-96); immune to Death, Terror, Paralysis.
 */
export class CurseMob extends ContentMob {
  constructor(id: number, pos: number, w: number, depth: number) {
    super(
      id,
      {
        id: 'curse',
        name: 'curse personification',
        sprite: 'mob_curse',
        hp: 10 + depth * 3,
        def: 10 + depth,
        atk: 10 + depth,
        dmgMin: 3,
        dmgMax: 5,
        dr: 1,
        speed: 0.5,
        flying: true,
        attackDelay: 1,
        triangular: true, // damageRoll = NormalIntRange(3, 5)
        ability: null,
        immunities: ['death', 'terror', 'paralysis'],
        resistances: [],
        exp: 3,
        maxLvl: 5,
      },
      pos,
      w,
    );
    this.state = 'hunting'; // CursePersonification.java:45
  }

  /**
   * CursePersonification.attackProc (CursePersonification.java:55-83):
   * pushes the enemy one cell directly away when that cell is passable (or
   * avoid) and unoccupied. For the hero, vanilla calls
   * Dungeon.level.press(newPos, enemy) — the trap-press only — which the
   * port models with pressTrapCell. A mob enemy (e.g. the honeypot bee,
   * which can be aggroed by the curse) is pushed the same way with the
   * mob trap-press (mobPressTrapCell).
   */
  override attackProc(ctx: ActionContext, enemy: ContentHero | ContentMob, damage: number): number {
    const w = this.w;
    const dx = (enemy.pos % w) - (this.pos % w);
    const dy = Math.floor(enemy.pos / w) - Math.floor(this.pos / w);
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) {
      const nx = (enemy.pos % w) + dx;
      const ny = Math.floor(enemy.pos / w) + dy;
      const newPos = ny * w + nx;
      if (ctx.level.isPassable(nx, ny) && charAtPos(ctx, newPos) == null) {
        enemy.pos = newPos;
        ctx.syncMobs();
        if (enemy instanceof ContentHero) pressTrapCell(ctx, newPos, enemy, () => undefined);
        else mobPressTrapCell(ctx, enemy as unknown as TrapMob, () => undefined);
      }
    }
    return damage;
  }

  /** CursePersonification.act (CursePersonification.java:86-91): +1 HP/turn while injured. */
  override takeTurn(ctx: ActionContext): number {
    if (this.hp > 0 && this.hp < this.ht) this.hp++;
    return super.takeTurn(ctx);
  }

  /**
   * CursePersonification.die (CursePersonification.java:92-96): replaced by
   * a passive ghost (the quest's given flag is already true — the player
   * accepted before the curse spawned).
   */
  override onDeath(ctx: ActionContext): void {
    const ghost = new GhostMob(nextNpcId(), this.pos, this.w);
    ghost.state = 'passive';
    ctx.addMob(ghost, 0); // Ghost.replace: the curse is destroyed, ghost added
  }
}

// ---------------------------------------------------------------------------
// Shopkeeper (live mob shell around the shop worker's logic class)
// ---------------------------------------------------------------------------

/**
 * The shopkeeper as a live NPC. Vanilla Shopkeeper.java (102 lines): a
 * passive, non-hostile NPC (NPC.java: HP=HT=1, EXP=0, hostile=false,
 * PASSIVE) that throws misplaced items off its tile each turn and opens the
 * trade UI on interact (Shopkeeper.java:96-98). The trade logic itself is
 * the shop worker's `Shopkeeper` class (src/content/shopkeeper.ts); this
 * mob only routes the shared onTalk contract to it.
 */
export class ShopkeeperMob extends NpcMob {
  private readonly keeper = new Shopkeeper();

  constructor(id: number, pos: number, w: number) {
    super(id, npcDef('shopkeeper', 'shopkeeper', 'mob_shopkeeper', 1, false), pos, w);
    this.state = 'passive';
  }

  override onTalk(_ctx: ActionContext): void {
    // The shop worker's contract is ShopTalkCtx { game, openShop }
    // (src/content/shopkeeper.ts). The onTalk path only uses openShop (the
    // sell window, Shopkeeper.java:96-98); the game half is read by the shop
    // UI directly from the UiManager, so the adapter carries the level.
    this.keeper.onTalk({
      game: { level: _ctx.level } as unknown as Game,
      openShop: (mode) => uiBridge.current?.openShop(mode),
    });
  }

  /** Flavor text (Shopkeeper.description(), Shopkeeper.java:67-73). */
  description(): string {
    return this.keeper.description();
  }
}

// ---------------------------------------------------------------------------
// Blacksmith (Worker 5: quest dialog + reforge)
// ---------------------------------------------------------------------------

/** Blacksmith.java quest dialog strings (Blacksmith.java:47-68). */
const TXT_GOLD_1 =
  "Hey human! Wanna be useful, eh? Take dis pickaxe and mine me some _dark gold ore_, _15 pieces_ should be enough. " +
  "What do you mean, how am I gonna pay? You greedy...\n" +
  "Ok, ok, I don't have money to pay, but I can do some smithin' for you. Consider yourself lucky, " +
  "I'm the only blacksmith around.";
const TXT_BLOOD_1 =
  "Hey human! Wanna be useful, eh? Take dis pickaxe and _kill a bat_ wit' it, I need its blood on the head. " +
  "What do you mean, how am I gonna pay? You greedy...\n" +
  "Ok, ok, I don't have money to pay, but I can do some smithin' for you. Consider yourself lucky, " +
  "I'm the only blacksmith around.";
const TXT2 = "Are you kiddin' me? Where is my pickaxe?!";
const TXT3 = "Dark gold ore. 15 pieces. Seriously, is it dat hard?";
const TXT4 = "I said I need bat blood on the pickaxe. Chop chop!";
const TXT_COMPLETED = "Oh, you have returned... Better late dan never.";
const TXT_GET_LOST = "I'm busy. Get lost!";
/** Blacksmith.TXT_LOOKS_BETTER (Blacksmith.java:68): GLog.p on reforge. */
const TXT_LOOKS_BETTER = "your %s certainly looks better now";
/** WndBlacksmith.TXT_PROMPT (WndBlacksmith.java:49-51). */
const TXT_REFORGE_PROMPT =
  "Ok, a deal is a deal, dat's what I can do for you: I can reforge " +
  "2 items and turn them into one of a better quality.";
/** WndBlacksmith.TXT_SELECT (WndBlacksmith.java:52-53). */
const TXT_REFORGE_SELECT = "Select an item to reforge";
/** WndBlacksmith.TXT_REFORGE (WndBlacksmith.java:54-55). */
const TXT_REFORGE_BUTTON = "Reforge them";

/**
 * A reforge candidate: one weapon/armor instance from the hero's inventory
 * or equipped gear.
 */
interface ReforgeCandidate {
  /** 'inv:<slot>' | 'wielded' | 'worn'. */
  key: string;
  itemId: string;
  isWeapon: boolean;
  label: string;
}

/**
 * The troll blacksmith (Blacksmith.java): quest giver + reforge smith.
 * Vanilla name "troll blacksmith" (Blacksmith.java:71), npc_blacksmith
 * sprite, NPC defaults (non-hostile, PASSIVE, invulnerable like the other
 * quest NPCs; NpcMob.throwItem covers act()).
 */
export class BlacksmithMob extends NpcMob {
  constructor(id: number, pos: number, w: number) {
    super(
      id,
      npcDef('blacksmith', 'troll blacksmith', 'npc_blacksmith', 1, false),
      pos,
      w,
    );
    this.state = 'passive'; // NPC default (NPC.java:30)
  }

  /**
   * Blacksmith.interact (Blacksmith.java:79-152): quest offer, quest
   * turn-in, reforge window, or the get-lost line, by quest state.
   */
  override onTalk(ctx: ActionContext): void {
    void this.interact(ctx);
  }

  private async interact(ctx: ActionContext): Promise<void> {
    const hero = heroOf(ctx);
    const q = blacksmithQuest;

    if (!q.given) {
      // WndQuest(TXT_GOLD_1/TXT_BLOOD_1); onBackPressed gives the pickaxe
      // (Blacksmith.java:83-107).
      await showDialog({
        title: 'Troll blacksmith',
        sprite: this.sprite,
        text: q.alternative ? TXT_BLOOD_1 : TXT_GOLD_1,
        choices: [],
      });
      q.given = true;
      q.completed = false;
      addToInventory(hero, 'pickaxe', 1);
      ctx.log('You now have pickaxe'); // Hero.TXT_YOU_NOW_HAVE
      return;
    }

    if (!q.completed) {
      await this.turnIn(ctx, hero);
      return;
    }

    if (!q.reforged) {
      await this.reforgeFlow(ctx, hero);
      return;
    }

    await showDialog({
      title: 'Troll blacksmith',
      sprite: this.sprite,
      text: TXT_GET_LOST,
      choices: [],
    });
  }

  /**
   * Quest turn-in (Blacksmith.java:109-150). Belongings.getItem searches
   * equipped gear first, then the backpack (Belongings.java:98-107,
   * 243-249), so an equipped pickaxe counts; it is unequipped without
   * collecting, then detached (Blacksmith.java:132-140: unequip, detach
   * pick, detachAll gold — in that order).
   */
  private async turnIn(ctx: ActionContext, hero: ContentHero): Promise<void> {
    const q = blacksmithQuest;
    const pickEquipped = hero.weaponId === 'pickaxe' && hero.weapon !== null;
    const pickSlot = hero.inventory.findIndex((s) => s.itemId === 'pickaxe');
    if (pickSlot === -1 && !pickEquipped) {
      await this.tell(TXT2);
      return;
    }
    const bloodStained = pickEquipped
      ? hero.weapon!.bloodStained === true
      : hero.inventory[pickSlot]?.gear?.weapon?.bloodStained === true;
    if (q.alternative) {
      if (!bloodStained) {
        await this.tell(TXT4);
        return;
      }
    } else {
      const goldQty = hero.inventory
        .filter((s) => s.itemId === 'darkgold')
        .reduce((sum, s) => sum + s.qty, 0);
      if (goldQty < 15) {
        await this.tell(TXT3);
        return;
      }
    }
    // Blacksmith.java:132-140 order: unequip the pickaxe (no collect),
    // detach it, then detachAll the dark gold (gold variant).
    if (pickEquipped) {
      hero.weapon = null;
      hero.weaponId = null;
    } else {
      removeFromInventory(hero, pickSlot, 1);
    }
    if (!q.alternative) {
      for (let i = hero.inventory.length - 1; i >= 0; i--) {
        if (hero.inventory[i]?.itemId === 'darkgold') {
          removeFromInventory(hero, i, hero.inventory[i]!.qty);
        }
      }
    }
    await this.tell(TXT_COMPLETED);
    q.completed = true;
    q.reforged = false;
  }

  /** WndQuest(this, text) (Blacksmith.java:154-156). */
  private tell(text: string): Promise<string> {
    return showDialog({
      title: 'Troll blacksmith',
      sprite: this.sprite,
      text,
      choices: [],
    });
  }

  /**
   * WndBlacksmith (WndBlacksmith.java) mapped onto the dialog system: pick
   * the first item (TXT_PROMPT), pick the second (TXT_SELECT), verify, then
   * the "Reforge them" confirmation runs Blacksmith.upgrade.
   */
  private async reforgeFlow(ctx: ActionContext, hero: ContentHero): Promise<void> {
    const first = await this.pickItem(hero, TXT_REFORGE_PROMPT, null);
    if (!first) return;
    const second = await this.pickItem(hero, TXT_REFORGE_SELECT, first);
    if (!second) return;
    const err = verifyReforge(hero, first, second);
    if (err) {
      // Vanilla shows the error inline and disables the reforge button
      // (WndBlacksmith.java:113-122); the dialog flow restarts selection.
      await showDialog({
        title: 'Troll blacksmith',
        sprite: this.sprite,
        text: err,
        choices: [],
      });
      return;
    }
    const confirm = await showDialog({
      title: 'Troll blacksmith',
      sprite: this.sprite,
      text: `Reforge the ${first.label} and the ${second.label} into one?`,
      choices: [
        { label: TXT_REFORGE_BUTTON, value: 'yes' },
        { label: 'Never mind', value: 'no' },
      ],
    });
    if (confirm === 'yes') {
      reforgeItems(ctx, hero, first, second);
    }
  }

  /**
   * Item-selection dialog (GameScene.selectItem, WndBag.Mode.UPGRADEABLE:
   * upgradable items only, WndBag.java:387). The port also lists equipped
   * gear — the vanilla upgrade() handles equipped items, and the port's
   * inventory UI surfaces them.
   */
  private async pickItem(
    hero: ContentHero,
    prompt: string,
    exclude: ReforgeCandidate | null,
  ): Promise<ReforgeCandidate | null> {
    const candidates = reforgeCandidates(hero).filter(
      (c) => !exclude || c.key !== exclude.key,
    );
    if (candidates.length === 0) {
      await showDialog({
        title: 'Troll blacksmith',
        sprite: this.sprite,
        text: 'You have nothing I can reforge.',
        choices: [],
      });
      return null;
    }
    const value = await showDialog({
      title: 'Troll blacksmith',
      sprite: this.sprite,
      text: prompt,
      choices: candidates.map((c) => ({ label: c.label, value: c.key })),
    });
    return candidates.find((c) => c.key === value) ?? null;
  }

  /** Flavor text (Blacksmith.description(), Blacksmith.java:233-238). */
  description(): string {
    return (
      "This troll blacksmith looks like all trolls look: he is tall and lean, and his skin resembles stone " +
      "in both color and texture. The troll blacksmith is tinkering with unproportionally small tools."
    );
  }
}

/**
 * Upgradable weapon/armor instances: inventory gear plus equipped gear
 * (see BlacksmithMob.pickItem).
 */
export function reforgeCandidates(hero: ContentHero): ReforgeCandidate[] {
  const out: ReforgeCandidate[] = [];
  const push = (
    key: string,
    itemId: string,
    isWeapon: boolean,
    level: number,
    upgradable: boolean | undefined,
  ) => {
    if (upgradable === false) return; // WndBag.Mode.UPGRADEABLE
    const def = getItem(itemId);
    out.push({
      key,
      itemId,
      isWeapon,
      label: level > 0 ? `${def.name} +${level}` : def.name,
    });
  };
  hero.inventory.forEach((s, slot) => {
    const g = s.gear;
    if (g?.weapon) {
      push(`inv:${slot}`, s.itemId, true, g.weapon.level, g.weapon.upgradable);
    } else if (g?.armor) {
      push(`inv:${slot}`, s.itemId, false, g.armor.level, g.armor.upgradable);
    } else {
      // Bare stacks (old saves): fall back to the catalog def.
      const def = getItem(s.itemId);
      if (def.weapon) {
        push(`inv:${slot}`, s.itemId, true, def.weapon.level, def.weapon.upgradable);
      } else if (def.armor) {
        push(`inv:${slot}`, s.itemId, false, def.armor.level, def.armor.upgradable);
      }
    }
  });
  if (hero.weaponId && hero.weapon) {
    push('wielded', hero.weaponId, true, hero.weapon.level, hero.weapon.upgradable);
  }
  if (hero.armorId && hero.armor) {
    push('worn', hero.armorId, false, hero.armor.level, hero.armor.upgradable);
  }
  return out;
}

/**
 * Blacksmith.verify (Blacksmith.java:158-184): returns the refusal string
 * or null. The port has no weapon/armor identification model (potions and
 * scrolls only), so the "identify them first" check cannot fire — noted as
 * a gap; all other checks are exact.
 */
export function verifyReforge(
  hero: ContentHero,
  c1: ReforgeCandidate,
  c2: ReforgeCandidate,
): string | null {
  if (c1.key === c2.key) {
    return 'Select 2 different items, not the same item twice!';
  }
  if (c1.itemId !== c2.itemId) {
    return 'Select 2 items of the same type!';
  }
  const g1 = reforgeGear(hero, c1);
  const g2 = reforgeGear(hero, c2);
  if ((g1?.cursed || g2?.cursed) === true) {
    return "I don't work with cursed items!";
  }
  if ((g1?.level ?? 0) < 0 || (g2?.level ?? 0) < 0) {
    return "It's a junk, the quality is too poor!";
  }
  if (g1?.upgradable === false || g2?.upgradable === false) {
    return "I can't reforge these items!";
  }
  return null;
}

/** The live gear instance behind a reforge candidate. */
function reforgeGear(
  hero: ContentHero,
  c: ReforgeCandidate,
): { level: number; cursed?: boolean; upgradable?: boolean } | null {
  if (c.key === 'wielded') return hero.weapon;
  if (c.key === 'worn') return hero.armor;
  const slot = Number(c.key.slice(4));
  const g = hero.inventory[slot]?.gear;
  return (c.isWeapon ? g?.weapon : g?.armor) ?? null;
}

/**
 * Blacksmith.upgrade (Blacksmith.java:186-214): the higher-level item
 * survives (ties keep the first), is upgraded once via Item.upgrade()
 * (clears curse, +1 level, fix — NO enchantment/glyph transfer), the
 * other is destroyed, 2 turns pass, Quest.reforged is set.
 */
export function reforgeItems(
  ctx: ActionContext,
  hero: ContentHero,
  c1: ReforgeCandidate,
  c2: ReforgeCandidate,
): void {
  const l1 = reforgeGear(hero, c1)?.level ?? 0;
  const l2 = reforgeGear(hero, c2)?.level ?? 0;
  const first = l2 > l1 ? c2 : c1;
  const second = first === c1 ? c2 : c1;

  // Unequip the survivor into the pack (vanilla: doUnequip(hero, true)
  // collects it into the backpack, Blacksmith.java:198-200), then upgrade.
  const survivorGear = reforgeGear(hero, first);
  if (first.key === 'wielded' && hero.weapon) {
    const inst = hero.weapon;
    hero.weapon = null;
    hero.weaponId = null;
    addToInventory(hero, first.itemId, 1, { weapon: inst });
  } else if (first.key === 'worn' && hero.armor) {
    const inst = hero.armor;
    hero.armor = null;
    hero.armorId = null;
    addToInventory(hero, first.itemId, 1, { armor: inst });
  }
  if (survivorGear && 'enchantment' in survivorGear) {
    upgradeItem(survivorGear as DurableItem, 'weapon');
  } else if (survivorGear) {
    upgradeItem(survivorGear as DurableItem, 'armor');
  }

  // Destroy the second (vanilla: unequip without collect, then detachAll,
  // Blacksmith.java:207-210).
  if (second.key === 'wielded') {
    hero.weapon = null;
    hero.weaponId = null;
  } else if (second.key === 'worn') {
    hero.armor = null;
    hero.armorId = null;
  } else {
    removeFromInventory(hero, Number(second.key.slice(4)), 1);
  }

  ctx.log(TXT_LOOKS_BETTER.replace('%s', first.label)); // GLog.p
  // Dungeon.hero.spendAndNext( 2f ) (Blacksmith.java:203): the talk intent
  // already cost 0, so the 2 turns advance the hero clock directly
  // (hunger/regen for the smithing time).
  tickHeroClock(ctx.rng, ctx, hero, 2);
  blacksmithQuest.reforged = true;
  // Journal.remove( Journal.Feature.TROLL ): no journal in the port.
}

// ---------------------------------------------------------------------------
// Builder registration
// ---------------------------------------------------------------------------

let npcIdCounter = -1;
/** Negative ids for quest-spawned mobs (never collide with nextMobId()). */
export function nextNpcId(): number {
  return npcIdCounter--;
}

/**
 * Build quest NPCs / quest mobs. Registered with the mob builder
 * (registerNpcBuilder) to avoid an npcs <-> mobs import cycle.
 */
/**
 * Ambitious imp (Stage 3, Worker E completion).
 *
 * Ground truth: watabou/pixel-dungeon, actors/mobs/npcs/Imp.java (GPL-3.0).
 * The imp offers the golem/monk bounty quest (Imp.Quest, Imp.java:158-248).
 * Full quest completion (dwarf token collection, Imp shop, ring reward) is
 * a known gap — the NPC, spawn, and quest state/persistence exist.
 */
export class ImpMob extends NpcMob {
  constructor(id: number, pos: number, w: number) {
    // mob_imp: imp.png — ImpSprite (stage3_workerE_sprites.ts).
    super(id, npcDef('imp', 'ambitious imp', 'mob_imp', 1, false), pos, w);
    this.state = 'wandering';
  }

  override onTalk(ctx: ActionContext): void {
    // Imp.interact (Imp.java:249-290): first talk gives the quest.
    if (!impQuest.given) {
      impQuest.given = true;
      const text = impQuest.alternative ? TXT_MONKS1 : TXT_GOLEMS1;
      ctx.log(text);
    } else if (!impQuest.completed) {
      const text = impQuest.alternative ? TXT_MONKS2 : TXT_GOLEMS2;
      ctx.log(text);
    } else {
      ctx.log('The imp is busy with his new shop.');
    }
  }

  /** Flavor text (Imp.description, Imp.java). */
  description(): string {
    return (
      'This imp is clearly up to something. He is being very polite, ' +
      'which is suspicious.'
    );
  }
}

/** Imp quest dialog (Imp.java:47-77), verbatim. */
const TXT_GOLEMS1 =
  'Are you an adventurer? I love adventurers! You can always rely on them ' +
  'if something needs to be killed. Am I right? For a bounty, of course ;)\n' +
  'In my case this is _golems_ who need to be killed. You see, I\'m going to start a ' +
  'little business here, but these stupid golems are bad for business! ' +
  'It\'s very hard to negotiate with wandering lumps of granite, damn them! ' +
  'So please, kill... let\'s say _6 of them_ and a reward is yours.';

const TXT_MONKS1 =
  'Are you an adventurer? I love adventurers! You can always rely on them ' +
  'if something needs to be killed. Am I right? For a bounty, of course ;)\n' +
  'In my case this is _monks_ who need to be killed. You see, I\'m going to start a ' +
  'little business here, but these lunatics don\'t buy anything themselves and ' +
  'will scare away other customers. ' +
  'So please, kill... let\'s say _8 of them_ and a reward is yours.';

const TXT_GOLEMS2 = 'How is your golem safari going?';

const TXT_MONKS2 =
  'Oh, you are still alive! I knew that your kung-fu is stronger ;) ' +
  'Just don\'t forget to grab these monks\' tokens.';

export function buildNpc(
  mobId: string,
  id: number,
  pos: number,
  w: number,
  depth: number,
): ContentMob | null {
  switch (mobId) {
    case 'ghost':
      return new GhostMob(id, pos, w);
    case 'wandmaker':
      return new WandmakerMob(id, pos, w);
    case 'fetidrat':
      return new FetidRatMob(id, pos, w);
    case 'curse':
      return new CurseMob(id, pos, w, depth);
    case 'shopkeeper':
      return new ShopkeeperMob(id, pos, w);
    case 'blacksmith':
      return new BlacksmithMob(id, pos, w);
    case 'imp':
      return new ImpMob(id, pos, w);
    default:
      return null;
  }
}

registerNpcBuilder(buildNpc);
registerSewersKillHook(onSewersKill);
