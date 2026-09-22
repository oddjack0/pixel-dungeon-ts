# Art Director Report — Pixel Dungeon v2, Milestone 1

## What was produced

**Style spec:** `docs/ART-STYLE.md` — "Storybook Dungeon" idiom derived from the
reference screenshots: saturated jewel tones, hue-shifted soft shading, 1px
near-black outlines on entities/items (full-bleed terrain, no outer outline),
top-left light, 16px logical grid rendered at 3×. Sewers read: damp mossy
flagstones, wet-stone walls with moss caps, teal water with white ripples,
warm wood features; hazards (chasm void, red trap plate) use the scene's
darkest/lightest anchors.

**Sprite sheets (all original, AI-assisted, magenta-keyed):** `art-src/`
- `sheet-terrain-a` (3×2): floor0, wall, door / door_locked, door_secret, water
- `sheet-terrain-b` (3×2): grass, chasm, stairs_down / stairs_up, trap_revealed, well
- `sheet-entities` (3×3): chest, hero_warrior, mob_rat / mob_gnoll, mob_crab, mob_swarm / mob_skeleton, mob_thief, mob_goo
- `sheet-items` (3×2): shortsword, dart, potion_red / potion_strength, ration, scroll

Every generation prompt carried the same reference image (the established
storybook sheet) for cross-sheet consistency.

**Pipeline:** `scripts/build_sprites.py` (adapted from the oracle's script):
magenta-key → crop → downscale to 16×16 → palette-quantize → emit
`src/assets/sprites.ts`. Key improvements over the oracle's version:
- Background removal is a **border-connected magenta flood fill** (`key_background`)
  instead of a per-pixel dark-magenta halo test — the image model shades dark
  folds with magenta-tinged tones, and the old test was eating whole sprites
  (thief's cloak, swarm beetles, well ring, crab legs).
- `drop_border_bleed`: drops small border-touching components (the model let
  goo slime spill ~40px into the thief's cell).
- Coverage threshold lowered 40%→25% (thin ribs/legs survive); quantize pool
  excludes magenta-tinted shadows and uses 30 (not 26) shared colors.
- Single output file `src/assets/sprites.ts` (not the old two-file split):
  `ART_PX`, `PALETTE`, `SPRITES` (29 keys), `REGION_TINTS` (5 regions, copied
  verbatim from the oracle), `validateSprites()`.

**Sprite inventory (29 keys):** hero (= hero_warrior alias), hero_warrior,
floor0, floor1 (mirrored variant), wall, door, door_locked, door_secret,
water, grass, chasm, stairs_up, stairs_down, trap_revealed, well, chest,
mob_rat, mob_gnoll, mob_crab, mob_swarm, mob_skeleton, mob_thief, mob_goo,
shortsword, dart, potion_red, potion_strength, ration, scroll.
floor/wall/door_secret stay on the tintable gray ramp (F,f,W,w) so
REGION_TINTS recolors them per region; door_secret uses the wall's gray ramp
so it blends until discovered.

**Tests:** `test/sprites.test.ts` — 6 tests, all pass (atlas validity, all M1
keys, tintable ramp usage, 5-region tints). `bun run typecheck` is clean for
`src/assets/sprites.ts` and the test (remaining repo errors are in other
workers' modules, e.g. `src/dungeon/painters.ts` vs `src/core/grid.ts`).

## QA results

- Contact sheet + labeled 8× strip + 24× zooms of every sprite, plus a
  sewers-tinted terrain set and a 3× in-game mock room (`docs/qa-*.png`).
- No keying fringes: silhouettes are clean on checkerboard and dark
  backgrounds; no magenta halos.
- All 29 sprites read at 3×/48px: hero (teal tunic, helm, sword), rat, gnoll
  (shield), crab (red, wide), swarm (dark beetle cluster), skeleton (bone
  white/gray), thief (dark hood), Goo (largest entity, glossy green, orange
  eyes). Items all distinct. Terrain tiles tile cleanly; door_secret is
  visually near-identical to wall.
- Known 16×16-downscale limits (accepted): thin rib/leg lines partially
  erode; the new renders are still cleaner than the oracle's equivalents
  (verified side-by-side). Skeleton reads slightly muddy at 1× but fine at 3×.

## Open issues / flags for the coordinator

1. **REGION_TINTS shape (resolved in favor of the oracle):** the engine
   architect's first placeholder used `Record<Region, string>` (one tint color
   per region); the SPEC contract points at the oracle's per-char override
   table `Record<string, Record<string,string>>` (F/f/W/w). I emitted the
   oracle's shape, and `src/engine/render.ts` already consumes it
   ("Per-region char overrides"). If anyone still expects the single-color
   shape, that needs a coordinator decision — do not silently change the
   emitted format.
2. **tsconfig/package.json:** the engine architect already created both; I
   reused theirs (no duplicate scaffold). My files typecheck clean.
3. **Unused QA intermediates:** `docs/qa-contact-sheet.png` (superseded by
   `qa-strip.png`), `scripts/qa_contact_sheet.py` kept for re-runs.
4. **Nothing published.** All art is original; no game pixels copied.
5. Later milestones will want: wall variants per region (only sewers used
   now), hero walk frames, Goo pump-up state, item throw sprites — none are
   M1 scope.

## Addendum 2026-09-19 — four missing item sprites (art touch-up)

The M1 atlas was missing `armor_cloth`, `gold`, `key_iron`, `key_skeleton`
(renderer showed magenta fallbacks). One new sheet was generated,
`art-src/media-generation-sheet-items-b-0-touchup.webp` (2×2, same prompt
formula: the storybook reference image + the original item sheet as style
anchors, pure magenta background; all four designs original).

**Pipeline:** new `scripts/add_sprites.py` reuses `build_sprites.py`'s keying /
crop / resize / coverage logic but merges **additively** — re-running the full
pipeline would median-cut the whole pool again and silently change all 29
existing sprites, so the existing atlas bytes were left untouched. The 4 new
sprites map to the nearest EXISTING palette char (outline luma<48 → `k` kept;
tintable ramp `F,f,W,w` excluded for items). Three documented KNOWN_PALETTE
chars not yet in use were appended for genuinely novel hues: `y` gold
(#f2c14e), `o` flame orange (#e8862e), `D` wood (#8a5a2b). The model's
magenta-tinted fold shadows (e.g. inside the key bows) map to the nearest
existing char and never earn a fallback, matching the original pipeline's pool
exclusion — an early merge version briefly introduced a `v` purple for those
shadows and was corrected. `MISSING_SPRITES` in `src/content/items.ts` is now
empty; the stale "known gaps" assertions in `test/content.test.ts` were
updated and all 4 keys added to `test/sprites.test.ts`'s completeness list.

**QA:** `docs/qa-touchup-items-b-3x.png` / `-8x.png` — 3×/48px on checkerboard:
clean keying, no magenta fringes or halos, all four readable and consistent
with the original item set (quilted tan armor, saturated gold coin pile, dark
iron key with sparkle, ornate golden skeleton key). Sprite inventory is now 33
keys. `bun run typecheck` clean; full suite 235/235 pass.

## Addendum 2026-09-19 — art-review fix round (8 findings + 1 note)

All fixes applied in the sprite pipeline / atlas; no art re-generation was
needed. Fixes live in `scripts/build_sprites.py` so future pipeline runs
reproduce them; the atlas was re-emitted with a **frozen palette** (see
below) to avoid silently shifting untouched sprites.

**Pipeline changes (`scripts/build_sprites.py`):**
- `fix_terrain_seam(rgba)` — detects trailing rows darker than 0.62× the
  interior median luma (the source art's dark border shadow surviving the
  bbox crop) and replaces each with a mirror of the rows above the band.
  Wired into `extract_sprites()` for `floor0`, `grass`, `water` (`floor1`
  inherits via its horizontal flip). Calibrated row lumas pre-fix:
  floor 57/42 vs ref 94, grass 54/40 vs ref 94, water 50 vs ref 98 —
  the 0.62 threshold catches exactly the dark rows, nothing else.
- `fill_edge_transparency(rgba)` — fills every border-connected transparent
  pixel on full-bleed terrain from its nearest opaque neighbor. Pre-fix
  edge `.` counts matched the review exactly (floor 17, grass 31, water 4,
  zero interior holes); post-fix all four tiles have **zero** transparent
  pixels.
- `touchup_rows(rows, char_luma)` — char-level fixes on the final 16×16
  atlas, each asserting its precondition so a future pipeline change that
  moves the pixels fails loudly instead of mis-editing:
  1. `mob_crab`: deleted the exact disconnected components at (5,2)-(6,2)
     and (0,8) (verified 2px and 1px components, nothing else touched).
  2. `mob_thief`: deleted the isolated stray pixel at (15,5).
  3. `mob_goo`: 1px `k` outline added to all outer-silhouette-edge pixels
     (41px); the single near-white gloss pixel `p` at (4,1) spared as a
     bright-rim break per ART-STYLE.md.
  4. `potion_strength`: full 1px `k` silhouette outline (vial + cork).
  5. `mob_thief` rim-light: 2px `A` (light neutral gray #a9b0b3, already in
     palette) on the hood's top-left edge at (5,2),(4,3).
- Wall `w` highlight (reviewer's NOTE, resolved as "give wall art a
  highlight char" — safer than dropping `w` from the SPEC-contracted
  `REGION_TINTS` shape): in `pixel_char`, wall top-cap (`y < 5`) pixels
  mapping to `W` with luma ≥ 80 (brighter than the W/w midpoint) now emit
  `w`. 12 pixels on the top cap; sewers tint lightens the cap subtly, per
  ART-STYLE.md ("top cap lighter"). `w` (#565e78, "wall top highlight")
  added to PALETTE — it was previously emitted-unused and therefore
  absent. `REGION_TINTS` shape untouched.

**Re-emission (`scripts/apply_art_fixes.py`, new):** runs the fixed pipeline
but quantizes against the **frozen** 30-center palette parsed from the
existing `sprites.ts` (new `quantize(..., fixed_centers=)` parameter),
then splices only the 9 changed sprite blocks back into the file —
PALETTE (plus the one `w` addition), REGION_TINTS, the 4 additively-merged
item sprites, header, and char-art format otherwise byte-identical.
Verified pre-splice: all 24 untouched sprites reproduce bit-identically,
so the median-cut pool shift from the terrain fixes touched nothing else.

**Per-item status:** all 8 findings fixed + the note resolved (see above).

**Verification:**
- `docs/qa-fix-tiling-{floor0,floor1,grass,water}.png` — 2×2 tiling at 3×:
  no dark bands; row-luma sweep across tile boundaries shows no dip
  (floor 72.6–84.1, grass 83.3–102.9, water 91.4–104.4; boundary rows
  continuous, vs pre-fix band luma ~26–57).
- Entity/item 8× zooms reviewed: goo outlined with gloss intact, potion
  vial crisply outlined, thief stray gone + subtle hood rim-light, crab
  floaters gone, wall cap highlight subtle.
- `bun run typecheck` clean; `test/sprites.test.ts` 6/6 pass; full
  `bun test` 256/256 pass.
- `dist/` not rebuilt (left to the code-fix agent); nothing outside
  `src/assets/`, `scripts/`, `test/sprites.test.ts` (untouched), `docs/`
  was modified.
