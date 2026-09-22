# Stage 2 completion log — 2026-09-22

## Scope
Caves depths 11–15, DM-300, all 12 potions, 12 scrolls, 13 wands, 12 rings,
11 enchantments, 11 glyphs, durability/curses, Blacksmith quest, pickaxe/dark
gold mining, Caves shop stock, and quest-state persistence.

## Deployed
- Repo: https://github.com/oddjack0/pixel-dungeon-ts
- Playable: https://oddjack0.github.io/pixel-dungeon-ts/
- Live bundle: `main.9891c49b93.js` (verified served 2026-09-22 ~22:45 UTC)
- `main` HEAD: `b67d58c`; gh-pages deploy commit `a3a3b68`

## Commits (main)
- `d74de6b` Worker 6: 65 new original sprites (194/194 pixel-identical),
  ghost/wandmaker/blacksmith quest state persisted in save/load.
- `83864f6` Worker 1: Caves generation 11–15, shop, Blacksmith room,
  DM-300 arena/sealing runtime. 54/54 new tests.
- `745dea4` Worker 5: durability/curses + 11 enchantments + 11 glyphs,
  exact names/descriptions, combat proc wiring. 76 tests.
- `ced31bc` Worker 4: 12 potions + 12 scrolls + run-assigned color/rune
  identification (ItemStatusHandler), honeypot catalog.
- `7e6353f` Worker 3: 13 wands + 12 rings; rules audited line-by-line
  against watabou/pixel-dungeon (Haggler/Mending/Elements/Thorns/
  Herbalism/Power/Flock/Shadows, wand price base 50, ring price base 80,
  teleportation 11-retry, etc.). RingSpec moved to mechanics/ to avoid a
  content import cycle.
- `7c85d79` Worker 2: cave spinner, fire elemental, dwarf monk; DM-300
  arena sealing, enrage, gas emission, death drops.
- `b67d58c` Integration: central catalog base defs for wands/rings, new
  'wand'/'ring' item types wired through inventory + UI, itemgen mappers,
  Blacksmith reforge dialog, pickaxe/dark gold, stale-test repairs.

## Verification
- `bun run typecheck`: clean.
- `bun test`: **793 pass, 0 fail** (28 test files).
- Sprite atlas: all catalog sprite keys resolve (fixed wand magic-missile
  key and 12 ring keys to match the extracted original names).
- Pickaxe price stays 0 per vanilla Item.java default (not overridden in
  Pickaxe.java); the broad "all weapons cost >0" expectation exempts it.

## Exact vs missing (honest)
EXACT / DONE:
- Caves 11–15 generation, shop, Blacksmith room, DM-300 fight.
- All 12 potions / 12 scrolls with vanilla identification, names, effects.
- All 13 wands (woods, charges, zap flow, per-instance normalization).
- All 12 rings (gems, buffs, Java-verified formulas).
- All 11 enchantments + 11 glyphs, durability, curses, combat procs.
- Blacksmith quest + reforge, pickaxe mining, dark gold.
- Quest state (ghost/wandmaker/blacksmith) persisted in saves.
MISSING / KNOWN GAPS:
- Honeypot Bee ally AI: needs mob-vs-mob combat + Bee target selection;
  catalog exists, shatter exists, faithful Bee behavior not finished.
- Wand zap and ring equip from the inventory UI: mechanics paths exist
  (`useWandFromSlot`, ring equip), inventory currently logs
  "Nothing happens" for these (drop-only in the UI).
- Wandmaker reward wiring exists; full end-to-end playtest of Caves
  11–15 + DM-300 on the live build still owed.
- Tile zoom: Bruno's open decision (vanilla ~96px vs current ~32-48px)
  — unchanged pending his answer.

## Notes for Stage 3
- Worker 5's runtime died mid-task; its tree work was inspected and kept.
  No replacement was dispatched; integration covered verification.
- `stash@{0}` (WIP on main: d940f3c) still exists with an older mobs.ts;
  do not blindly pop it.
- Six workers shared one tree; never use unscoped stash/reset/clean
  during parallel work.
- Deploy via /tmp staging; never ship stable bundle names; gh-pages
  serves index.html + hashed bundle at repo root.
