# Pixel Dungeon TS

A ground-up TypeScript port of **Pixel Dungeon**, playable in the browser. HTML5 Canvas, no heavy engine dependencies.

**Play it:** https://oddjack0.github.io/pixel-dungeon-ts/

## Credit

The original game **Pixel Dungeon** was created by [Watabou](https://github.com/watabou/pixel-dungeon) and is the ground truth for this port's mechanics. The sprite set in `src/assets/original_sprites.ts` is extracted directly from the original game's assets (hero, mobs, items, and terrain tiles) and used under the same license — see `scripts/extract_original_sprites.ts` for the per-sprite source mapping. Thank you, Watabou.

This project is a GPL-3.0 derivative: it is and will remain open source. See [LICENSE](LICENSE).

## Goal

A faithful port: descend all 26 floors, defeat Yog-Dzewa, take the Amulet of Yendor, ascend, and reach the victory screen.

## Develop

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run test        # bun test
bun run build       # bundles src/main.ts -> dist/, copies index.html
```

Then serve `dist/` with any static server (e.g. `bunx serve dist`) and open it in a browser.

## Project layout

- `src/` — game source (dungeon generation, entities, items, combat, UI)
- `art-src/` — original sprite sheet masters
- `test/` — unit tests
- `docs/` — build/QA reports and art review screenshots
- `SPEC.md` — the build spec

## Status

Under active development in checkpointed stages, each followed by a playtest. Current stage: Milestone 1 (grid engine, movement, rendering, dungeon generation, combat, items); rendering now uses the original Pixel Dungeon sprites (GPL-3.0, credit Watabou) via `src/assets/original_sprites.ts`.
