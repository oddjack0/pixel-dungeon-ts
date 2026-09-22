# Content Report — Milestone 1 (Warrior, Sewers 1–4, Goo)

Designer: content (Muse). Date: 2026-09-19.

## What shipped

**`src/content/items.ts`** — the 7-item M1 catalog (shortsword, dart,
cloth_armor, potion_healing, potion_strength, ration, scroll) plus gold,
iron_key, skeleton_key (needed by generator/Goo). Data-driven defs with Java
citations, exact core stats, `getItem`/`parseItemId` (sized ids like
`gold:25`, `dart:8`), `spriteFor`, and a missing-sprite registry
(`missingCatalogSprites()` / `MISSING_SPRITES`).

**`src/content/mobs.ts`** — sewer roster (rat, gnoll, crab, swarm,
skeleton, thief) with Java-exact stats; `ContentMob` scheduler actor using
canonical cell-index `pos` with `x`/`y` bridges; full AI
(sleeping/wandering/hunting/fleeing per Mob.java, wake/alert tests,
vanilla turn costs); swarm split (HP halving, free-neighbor, clone hunts,
burning/poison propagation); skeleton death burst; thief steal/flee/
gold-drop/stolen-loot; `runAttackSequence` mirroring Char.attack step order
so defenseProc (split) lands before damage; EXP/loot pipeline with the
`maxLvl+2` gate; shared `tickBuffs` (burning/poison/ooze/paralysis).

**`src/content/goo-boss.ts`** — Goo: pump (1/3, 2-turn), pumped/jump
attacks (accuracy 15/30), pump fizzle, pump cleared by moving, water regen,
1/3 ooze on hit, arena seal on move, unseal + skeleton key + yell on death.

**`src/content/hero.ts`** — `ContentHero` (warrior: STR 11, shortsword +
cloth armor equipped, ration + 8 darts in inventory); inventory as single
source of truth; stack merging; save-safe plain data.

**`src/content/actions.ts`** — pickup (one heap/turn, gold to counter),
drink/eat/equip/unequip/drop, iron-key door unlock, skeleton-key exit
unlock, dart throwing with Bresenham trace (first mob hit, miss lands the
dart), hunger/regen clock (10 time units, vanilla messages, starvation can
kill).

**`src/content/spawns.ts`** — Bestiary.mobClass tables (depths 1–4; Goo on
5), weighted `pickMobId`, painter/quest tag → catalog resolution (all 20
tags mapped; unknown tags throw), sized gold/dart drops, `contentLevelGen`
(resolves items, stashes the GenResult via WeakMap for `spawnMobs`).
Fair-distance-from-entrance is preserved (resolution never moves a spawn;
tested).

**`src/content/hooks.ts`** — the real `MechanicsHooks`: buff ticking +
paralysis gating + hunger clock around every hero intent; all 9 intent
kinds (move/attack/pickup/useItem/equip/drop/throwItem/wait/descend-ascend
guard); mob turns via `takeTurn`; save/revive blobs (hero: stats, gear,
inventory, gold, hunger, buffs; mob: state, generation, stolen, pump);
registers a content inventory adapter (`setInventoryAdapter`) with the
slot convention inventory index / -1 weapon / -2 armor.

**Engine/UI wiring** — `ui.ts` now boots
`new Game(seed, { gen: contentLevelGen, mechanics: contentMechanics })`
(replacing `sewersLevelGen`/`stubMechanics`); `ActionContext.addMob`
(added to the seam + implemented in `loop.ts`) for the swarm split.

**`test/content.test.ts`** — 82 tests: catalog completeness + sprite
coverage, Java-exact mob stats, spawn-table distributions, split/steal/
burst mechanics, AI transitions, Goo fight arc, all interactions,
save/revive round-trips, engine wiring incl. a live 30-turn Game and the
loadGame `[]` fallback.

## Verification

- `bun run typecheck`: clean.
- `bun test`: **235 pass, 0 fail** across 11 files (82 content).
- Gameplay smokes (disposable scripts): greedy bot fought/killed/looted/
  leveled/ate/starved across depths 1–3; Goo fight verified end-to-end
  (pump, ooze, jump decision, death → unseal + skeleton key, EXP level-up).

## Escalations / open items

1. **Missing art (blocking sprite completeness):** `armor_cloth`, `gold`,
   `key_iron`, `key_skeleton` are not in the atlas. Catalog flags them via
   `MISSING_SPRITES`; the renderer falls back to a magenta marker. Needs
   the art owner.
2. **Gold/keys in the catalog:** added because the generator and Goo need
   them, though the brief listed only seven items. Confirm they belong in
   `items.ts` vs. a separate currency/key model.
3. **M1 simplifications (documented in code):** buffs tick once per owner
   turn instead of as separate scheduler actors; chests/bones/mimics place
   items directly; unidentified potions/scrolls collapse to
   healing/blank scroll; prize wands/rings → scroll; golden key → iron key;
   dewdrops → healing potion; no beastiary entries beyond the sewer roster
   (ghost/ratking/statue/piranha spawns skipped); sealed-arena movement
   blocking not enforced (flag only).
4. **Scope questions for the coordinator:** unarmed damage when unwielded
   (currently allowed); dart targeting only via mob tap (UI flow, kept);
   EXP `maxLvl+2` loot gate applied as in vanilla.

## What's next (not this milestone)

Depths 6–25, remaining items/mobs/rings/wands/scroll ID system, traps,
secret doors, shops/NPCs, alchemy, enchantments, save migration, and the
four missing sprites.
