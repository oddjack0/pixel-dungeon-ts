# UI Report — Pixel Dungeon v2, Milestone 1

**Status:** complete. `bun run typecheck` clean, `bun test` 153/153 pass
(23 new UI tests in `test/ui.test.ts`), `bun run build` produces a working
`dist/` (index.html + main.js, 155 KB — the jump from 48.5 KB is the real
Sewers generator now being bundled).

## What was built (`src/ui/`)

| File | Contents |
|---|---|
| `palette.ts` | Storybook UI palette (parchment panels, `#14161c` ink outlines matching sprite char `k`, jewel-tone accents) + shared canvas helpers (`drawPanel`, `drawBar`, `drawButton`, `drawCoin`, `drawDrumstick`, `TAP=44` minimum tap target). Simple canvas shapes only for bars/frames; all entity/item icons come from the sprite atlas. |
| `heroView.ts` | Read-only view-model over the live `Game` hero (SPEC §6: UI reads, never duplicates). HP/HT, lvl, exp/`maxExp(lvl)` (mechanics `exp.ts`), STR, hunger level from `buffs['hunger'].left`, gold (structural; 0 until content adds it), buff kinds. |
| `hud.ts` | Top bar: HP bar with numbers (pulses dark red under 25%), depth + region label, seed display, EXP bar + `Lvl N (exp/max)`, hunger drumstick badge (Full/Hungry/Starving!), gold coin + count, buff pills (Burning/Poisoned/Oozed/Paralysed/Rooted). Bottom: `LogBuffer` — last 4 game-log lines, alpha-fading over 9s. Quick-action slots bottom-right: potion (Drink) + dart (Throw), 56px tap targets. |
| `inventory.ts` | `I` key panel (bottom sheet on portrait, centered dialog on wide). `UiItem` view-model + `InventoryAdapter` seam: the default adapter renders the warrior kit from the mechanics Hero — equipped short sword, equipped cloth armor, dart stack ×8, ration — and merges any content-owned `inventory` array; the content designer can replace the adapter via `setInventoryAdapter()` without touching UI. Context-aware actions per type (potion: Drink/Drop, food: Eat/Drop, weapon/armor: Wield-Wear/Unwield/Drop, darts: Throw/Drop). `doItemAction` dispatches to `HeroIntent`. |
| `minimap.ts` | `M` key toggles. `computeMinimap` (pure, tested) folds explored memory into cell codes in the storybook palette — mossy-green floors, purple-gray walls, teal water, wood doors, gold stairs — with a pulsing white hero marker, red hostile-mob dots, and gold stair chevrons. Mobs only mark explored cells (no leaking unexplored terrain). |
| `screens.ts` | Title screen (New Run / Continue iff a save exists / seed field with keyboard entry + 🎲 random), death screen (cause of death from the log, depth, turns, level, kills, gold, seed — permadeath run summary, Try Again / Title), pause overlay (controls + Resume / All Controls / Save & Quit to Title / Abandon Run), help overlay (full control list). |
| `effects.ts` | Frame-diff combat feedback (robust, not message parsing): damage numbers (red on hero, cream on mobs), heal numbers (green), hit flashes, death-poof particles (fires `onMobDeath` → kill counter), potion-drink sparkles (log-keyed, degrades gracefully), level-up banner + gold burst, **Goo pump-up telegraph** (rising-edge "!" + expanding ring, then a pulsing orange warning ring while `pumpedUp`), **Goo boss HP bar** top-center once Goo has been seen. |
| `ui.ts` | `UiManager`: owns run lifecycle, rAF loop + 110ms hero pacing (moved from `main.ts`), capture-phase tap/key routing (panels and throw-targeting consume events before `engine/input.ts`), throw mode (dart slot → tap a target → `throwItem` intent), auto-save on hide, Ctrl+S, `?seed=N` pre-fill. |

## Layout decisions

- **Phone portrait first** (360–430px CSS width): compact 64px top bar, 56px
  quick slots bottom-right, inventory as a bottom sheet, minimap as a
  top-right panel (≤240px). Everything ≥44px tap targets, text ≥11px.
- **Overlays paint after the dungeon** in one canvas: effects → HUD →
  minimap → inventory → screens. The renderer still owns only the dungeon
  view; UI chrome never redraws entity art.
- **Modals swallow input**: open inventory / throw mode / any screen consumes
  taps and game keys via capture-phase handlers so the hero never walks
  while you're picking items.
- **Death is a screen, not a log line**: `gameOver` flips the state machine
  to the run summary automatically.

## Control list

| Input | Action |
|---|---|
| Arrows / WASD / QEZC | Move (8-dir) |
| Space / . | Wait a turn |
| G | Pick up |
| I | Inventory (Esc closes) |
| M | Minimap |
| `>` / `<` | Descend / ascend stairs |
| Esc (or P) | Pause / resume (cancels throw mode first) |
| Tap dungeon | Tap-to-move path |
| Tap adjacent enemy | Attack |
| Tap hero | Wait |
| Potion slot | Drink first potion |
| Dart slot → tap foe | Throw a dart (Esc cancels) |
| Ctrl+S | Save run |

## Integration decisions / seams (need coordinator ratification)

1. **`HeroIntent` extended** (`src/engine/seams.ts`, additive): `equip`,
   `drop`, `throwItem { slot, targetId }`. The inventory panel queues them;
   the **mechanics worker must implement them** in `handleHeroIntent`.
   `stubMechanics` got a `default:` guard (logs + returns 1) so the current
   build can't corrupt the scheduler on an unhandled kind.
2. **`Renderer.tileToScreen`** added (additive, inverse of `screenToTile`)
   so effects/HUD can place overlays on tiles.
3. **`src/main.ts` rewritten** to boot `UiManager` (title screen first).
   `?seed=N` now pre-fills the title seed field; `?continue=1` is replaced
   by the title screen's Continue button (still backed by
   `pdv2-save-1`). The old always-new-run boot is gone.
4. **Boot now uses the real Sewers generator** (`sewersLevelGen`) instead of
   `stubLevelGen`; mechanics is still `stubMechanics` until the mechanics
   hooks land.
5. **Inventory is adapter-shaped**: until `src/content/items.ts` lands, the
   panel shows the warrior kit synthesized from the mechanics Hero
   (verified in tests with a mechanics-shaped hero; with today's stub hero
   only the ration row appears — expected).

## Open issues

- **No live-browser playtest**: no browser access from this worker. Canvas
  drawing is smoke-tested headless (no-op context proxy), but the real
  pixel output, tap hit-areas, and phone-portrait layout need a human look
  at `dist/`.
- **Armor icon fallback**: the M1 atlas has no armor sprite, so cloth armor
  temporarily uses the `scroll` sprite in the inventory list. Art director:
  an `armor_cloth` sprite (or a generic armor icon) would fix this properly.
- **Potion/food sprites exist** (`potion_red`, `potion_strength`, `ration`)
  but no content inventory feeds them yet — quick-slot potion shows dimmed
  until the content designer lands items.
- **Goo telegraph reads `pumpedUp` structurally** off the mob (`(m as
  {pumpedUp?: boolean}).pumpedUp`); if the content/mob implementation names
  it differently, update `isGoo`/the flag read in `effects.ts`.
- **Kill attribution**: kills increment when a mob id disappears from
  `game.mobs` between frames — correct for combat deaths; harmless for
  despawns (none in M1).
