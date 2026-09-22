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
  type ContentHero,
} from './hero.js';
import { getItem } from './items.js';
import { itemGenerator } from './itemgen.js';
import { pressTrapCell } from '../mechanics/traps.js';
import { showDialog, uiBridge } from '../ui/dialog.js';
import { Shopkeeper } from './shopkeeper.js';
import type { Game } from '../engine/loop.js';

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
   * The exact wand identities drawn at spawn (Wandmaker.java:203-230).
   * Stored as descriptor ids ('wand_avalanche', ...); the wand item classes
   * themselves are the items worker's Stage-1/2 system.
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
 * Save-bundle form of the three run-level quest singletons (vanilla
 * Dungeon.storeInBundle -> Ghost.Quest.storeInBundle (Ghost.java:194-216),
 * Wandmaker.Quest.storeInBundle (Wandmaker.java:143-160),
 * Blacksmith.Quest.storeInBundle (Blacksmith.java:275-290)).
 * JSON-serializable; restored with restoreQuestState().
 */
export interface QuestSaveData {
  ghost: GhostQuestState;
  wandmaker: WandmakerQuestState;
  blacksmith: BlacksmithQuestState;
}

/** Snapshot the quest singletons for the save bundle. */
export function saveQuestState(): QuestSaveData {
  return {
    ghost: { ...ghostQuest },
    wandmaker: { ...wandmakerQuest },
    blacksmith: { ...blacksmithQuest },
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
  // random().upgrade() randomizes then +1s the wand level; the wand item
  // classes are the items worker's system, so the quest stores the exact
  // identities and the upgrade is applied when the real wands land.
  const battle = [
    'wand_avalanche',
    'wand_disintegration',
    'wand_firebolt',
    'wand_lightning',
    'wand_poison',
  ];
  const nonBattle = [
    'wand_amok',
    'wand_blink',
    'wand_regrowth',
    'wand_slowness',
    'wand_reach',
  ];
  wandmakerQuest.wand1 = rng.pick(battle);
  wandmakerQuest.wand2 = rng.pick(nonBattle);
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
  const wandDesc = value === 'battle' ? wandmakerQuest.wand1 : wandmakerQuest.wand2;
  const grantId = resolveWandReward(wandDesc);
  if (grantId) {
    // identify(): the port has no identification system (auto-identified).
    // Vanilla: doPickUp into the pack, else drop at the wandmaker's tile.
    // The port's pack is unbounded (M1), so the drop fallback is unreachable.
    addToInventory(hero, grantId, 1);
    ctx.log(`You now have the ${getItem(grantId).name}.`); // Hero.TXT_YOU_NOW_HAVE
  }
  ctx.log(fillClassName('The old wandmaker yells: ' + TXT_FAREWELL_WANDMAKER));
  ctx.removeMob(wandmaker); // wandmaker.destroy(): silent, no death pipeline
  // Vanilla Quest.complete(): wand1/wand2 = null, journal removed.
  wandmakerQuest.wand1 = null;
  wandmakerQuest.wand2 = null;
}

/**
 * Map the drawn wand identity to a grantable catalog id. The ten wand
 * classes (WandOfAvalanche, WandOfDisintegration, WandOfFirebolt,
 * WandOfLightning, WandOfPoison, WandOfAmok, WandOfBlink, WandOfRegrowth,
 * WandOfSlowness, WandOfReach — Wandmaker.java:205-230) are the items
 * worker's Stage-1/2 system; until they land, the quest grants the scroll
 * placeholder the generator already uses for unported wand scrolls
 * (itemgen.ts: the quest stores the exact wand identity in wandmakerQuest
 * so the grant upgrades cleanly to the real wand).
 */
export function resolveWandReward(wandDesc: string | null): string | null {
  if (wandDesc === null) return null;
  void wandDesc;
  return 'scroll'; // STAGE-1 PLACEHOLDER: replaced by the real wand class id
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
   * port models with pressTrapCell.
   */
  override attackProc(ctx: ActionContext, hero: ContentHero, damage: number): number {
    const w = this.w;
    const dx = (hero.pos % w) - (this.pos % w);
    const dy = Math.floor(hero.pos / w) - Math.floor(this.pos / w);
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) {
      const nx = (hero.pos % w) + dx;
      const ny = Math.floor(hero.pos / w) + dy;
      const newPos = ny * w + nx;
      if (ctx.level.isPassable(nx, ny) && charAtPos(ctx, newPos) == null) {
        hero.pos = newPos;
        ctx.syncMobs();
        pressTrapCell(ctx, newPos, hero, () => undefined);
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
    default:
      return null;
  }
}

registerNpcBuilder(buildNpc);
registerSewersKillHook(onSewersKill);
