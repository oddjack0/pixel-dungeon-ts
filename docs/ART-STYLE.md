# Pixel Dungeon v2 — Art Style Spec ("Sunlit Overgrown Grotto"), v3

Binding art direction for all sprites. This v3 **replaces ART-STYLE.md v2
entirely** after the v2 attempt was rejected by Bruno ("the one you just
showed me looks horrible") despite passing its numeric gates. The v2 spec
contained the poison: its numbers were sampled from a mood ("mossy
flagstone", "teal water") instead of from the references. v3 anchors
everything to hex values sampled directly from the reference screenshots
(`~/workspace/user/files/2133_2_kdo0.jpg`, `~/workspace/user/files/2131_3_28um.jpg`:
Secret-of-Mana-style bright sunlit storybook village). **When any v2 number
conflicts with a v3 number, v3 wins and the v2 number is dead.**

## 0. Why v2 failed (post-mortem — do not repeat)

1. **Floor was spec'd as stone at ~30% saturation (`#8ba35b`).** The
   references' ground is GRASS at saturation ~60–70%. A desaturated "mossy
   flagstone" floor can never read as the references' meadow. → v3 floors
   are grass, sat 55–75%, hue 95–115°.
2. **Water was spec'd cyan-teal (`#1f9fd8`–`#2bb5e8`).** The references'
   water is saturated medium BLUE, hue ~200, sat ~85–95%. Teal reads
   "swimming pool"; blue reads "the reference river". → v3 water is blue,
   `#1080c0` dominant. The v2 teal band is banned.
3. **A "white ripples ≥ 20%" gate actively manufactured ice.** Foam is an
   accent on a blue fill, not a wash over it. v2 water tiles were
   majority-pale. → v3: blue fill ≥ 70% of the water tile, white foam
   ≤ 12%, and any fill pixel with saturation < 40% fails the tile.
4. **Camo-speckled floors.** High-contrast dark speckle clusters on the
   floor read as military camouflage, not meadow. → v3 texture = smooth
   base with sparse subtle clumps (Δluma ≤ 12 from base).
5. **Walls as dark moss blocks.** The references have no "mossy stone"
   walls — riverbanks are brown DIRT faces with grass caps. v3 walls =
   reference dirt cliffs: brown face, grass cap, darker warm-brown shading.

## 1. The winning concept

**"Sunlit overgrown grotto."** It must read as Pixel Dungeon's dungeon
(rooms, corridors, doors, stairs, hazards — the mechanics and the
top-down 3/4 idiom are untouched) wearing the reference village's skin:
reference grass floors, reference dirt-cliff walls with grass caps,
reference blue water, warm reference browns for wood and stone. Sunlit
mood even underground — a dungeon lit by cheerful skylights, overgrown
and friendly, never gloomy. Chunky pixels, no noise, no blur, no
sub-pixel detail; every sprite identifiable at 16×16.

## 2. Scale & format (hard, unchanged)

- 16×16 grid per cell; sheets generated large, downscaled by
  `scripts/build_sprites.py` (BOX resample).
- Each sprite: 16 strings × 16 chars; char → PALETTE; `.` transparent.
- Palette-char contract unchanged. **F/f/W/w are flat-replacement tint
  chars** (`REGION_TINTS` in `src/assets/sprites.ts`): the tint hexes ARE
  the final on-screen colors. Source art for those four chars stays
  near-gray; colored detail (moss, flowers, strata) uses other chars and
  is authored at full reference saturation.
- **Water has its own palette chars (H/C/M/p/…) — it is NOT tinted.** Its
  blues are authored directly in the source art. This is why the water
  bans below are enforced on the source art itself.
- M1 scope = Sewers only (depths 1–5). Only Sewers terrain ships.

## 3. Value structure (the "still a dungeon" rule)

Lightness (relative luma 0–255), sampled on the **final in-game tile**
(post-tint where applicable):

- **Floor base (F after tint): luma 115–160** — sunlit grass.
- **Floor clumps (f after tint): luma 85–120**, same hue family as F.
- **Wall grass cap (w after tint): luma 130–170** — the brightest terrain
  in the scene.
- **Wall dirt face (W after tint): luma 70–105** — clearly darker than the
  floor so rooms read; never below 70.
- **Ordering gate (every region): `w > F > f > W`.**
- **Value floor:** nothing in a base material ramp below luma 60
  **except**: chasm void, trap teeth base, and small prop openings
  (doorway darkness, well pit interior, chest mouth) — these stay small
  (a few % of the tile) and are ringed with a 1px warm rim `#2b2226`.
- **Hazards must shout:** trap_revealed = warning red (brightest
  saturated anchor), chasm = near-black void (darkest anchor). Mechanics
  readability comes from **hue and value contrast**, never from
  desaturating the scene.

## 4. Exact material ramps (hexes — these are the law)

### Grass floor (Sewers post-tint targets)
| Role | Hex | Notes |
|---|---|---|
| F — floor base | `#5da02e` | reference dominant grass; hue ~99, sat ~66% |
| f — floor clump/shade | `#4b7e2a` | darker grass tufts, sparse |
| Detail light (authored, sat-bypass) | `#7cc24a` | single-pixel blade accents, rare |
| Detail deep (authored, sat-bypass) | `#3d6626` | clump roots/shade |
| Flower dots (authored, ≤ 2/tile) | `#ffffff` / `#f2c14e` | tiny white/yellow accents |

### Dirt-cliff walls (Sewers post-tint targets)
| Role | Hex | Notes |
|---|---|---|
| W — dirt face | `#6e4c2c` | warm brown earth face; darker than floor |
| w — grass cap | `#74b53a` | sunlit cap, **brightest** terrain |
| Cap lip (authored) | `#4f8a2a` | 1px transition between cap and face |
| Strata lines (authored) | `#5a3d24` | thin horizontal bands in the face |
| Small stones/roots (authored) | `#8a6a42` / `#5a4028` | sparse, never clusters |

### Water (authored directly — NOT tinted)
| Role | Hex | Notes |
|---|---|---|
| Fill dominant | `#1080c0` | ≥ 70% of the tile; hue ~197, sat ~90% |
| Fill mid | `#00679e` | variation bands |
| Deep pockets | `#003f66` | sparse, ≤ 15% of tile |
| Light glint | `#2a9ad6` | 1px top-left biased strokes |
| Sparkle | `#7cc8ef` | 1–2 four-point sparkles, tiny |
| Foam | `#ffffff` | ≤ 12% of tile, edge accents only |
| Edge | `#0a3d5c` | tile borders |

### Wood (doors, chest, well frame)
| Role | Hex |
|---|---|
| Outline | `#2b2226` |
| Deep | `#5a3a20` |
| Base | `#a8763f` |
| Plank shade | `#7a4f2a` |
| Light | `#d0a060` |
| Glint | `#ffd9a0` |

### Warm stone (stairs, well ring)
| Role | Hex |
|---|---|
| Deep | `#6b5a44` |
| Base | `#9a8a70` |
| Light | `#c0b090` |
| Sparkle | `#e8dcc0` |

### Chasm
| Role | Hex |
|---|---|
| Core void | `#0d0b10` |
| Inner | `#1a1418` |
| Rim | `#2b2226` |
| Faint earth glints | `#4a3828` (sparse, warm — never purple) |

### trap_revealed
| Role | Hex |
|---|---|
| Base | `#e04434` (warning red, sat ≥ 70%) |
| Deep | `#8f1f16` |
| Light | `#f06655` |
| Teeth | `#f6efdb` near-white with `#ffd9a0` glint |
| Outline | `#2b2226` |

## 5. REGION_TINTS — Sewers v3 values (code-side change, binding)

Because tints are flat replacement, these hexes are the final on-screen
colors. The supervisor must apply these to `REGION_TINTS.sewers` in
`src/assets/sprites.ts` when the v3 sheets land:

- `F: #5da02e` — reference grass base (luma ≈ 127, sat ≈ 66%)
- `f: #4b7e2a` — grass clump shade (luma ≈ 101)
- `W: #6e4c2c` — dirt-brown wall face (luma ≈ 82), darker than floor
- `w: #74b53a` — sunlit grass cap (luma ≈ 147), brightest terrain

Ordering check: 147 > 127 > 101 > 82 → `w > F > f > W` ✓.
Other regions are out of M1 scope; when they are authored, each set must
be authored to final on-screen targets and pass §3/§6.

## 6. Explicit bans (fail the sheet if any triggers)

1. **Neon-lime greens.** BANNED on floor tiles: any floor pixel with
   hue < 85° and saturation > 75% (the `#7cb342` v2 poison class).
   Floor greens must sit at hue 95–115°, saturation 55–75%.
2. **Icy white-blue water.** BANNED on water tiles: any fill pixel with
   saturation < 40%. Blue fill pixels must cover ≥ 70% of the tile;
   white foam pixels ≤ 12%. The v2 "ripples ≥ 20%" gate is struck and
   must not be reinstated; `scripts/stamp_ripples.py` must be capped so
   stamped foam stays within the 12% budget.
3. **Camo-speckled floors.** BANNED: high-contrast speckle clusters
   (adjacent-pixel Δluma > 25 over any region larger than 3×3). Floor
   texture = smooth base with sparse subtle clumps (Δluma ≤ 12 from
   base) and occasional single-pixel accents. If the tile reads as
   camouflage at 3×, it fails.
4. **Muddy gray tints.** BANNED: neutral-gray stone/detail fills
   (saturation < 12% on any pixel meant to be "stone", "dirt", or
   "wood"). Grays must carry a visible warm-brown or cool blue-green
   cast. The v2 stone-saturation band (18–35% "never gray" prose) is
   superseded: stone tints now target the reference greens/browns
   above, which are inherently saturated.
5. **Teal/cyan water.** The v2 water band `#1f9fd8`–`#2bb5e8` as a *fill*
   is banned; those hexes may appear only as the small light-glint
   role in §4. Water hue must read blue (190–210°), never cyan-teal,
   never navy-slate.

## 7. Water treatment (the anti-ice rule)

- The tile must read BLUE at a glance from 3×: fill dominant
  `#1080c0` ≥ 70%.
- Foam/ripples are edge accents: thin white arcs hugging tile edges and
  1–2 sparkles, total white ≤ 12%. Never a white wash across the tile.
- Deep pockets `#003f66` give depth; never let pale pixels (sat < 40%)
  cover more than a few % of the tile.
- Shoreline tiles (water next to grass in-game) may carry a 1px
  `#0a3d5c`→grass transition, but the water side stays blue.

## 8. Outline & lighting rules

- Entity/item/furniture silhouettes: 1px outline in **dark warm brown
  `#2b2226`** (not pure black).
- **Light-facing edges break the outline**: top and top-left edges get
  the 1px highlight color instead of outline (sunlit rim). This does
  most of the "sunlit" work on entities.
- Terrain tiles full-bleed, no outer outline; wall-meets-floor gets a
  1px `#2b2226` inner edge on the wall side only.
- Shadows hue-shift, never just darken: greens shade toward teal-blue,
  browns toward warm red. Shadows keep ≥ 60% of base saturation.
- Pillow shading: one rounded highlight blob (top-left biased) on every
  glossy/organic form (Goo, potions, helmets).

## 9. Entity & item charm rules (storybook, not gritty)

- Proportions slightly chibi on humanoids; faces simple with 2px eyes
  minimum; hero confident/cheerful; mobs get personality but glowing or
  angry eyes mark hostiles.
- Signature hues (unchanged roster): warrior teal `#2e8f86` tunic +
  steel helm; rat warm gray `#8a7f72` with pink `#e08a8a` ears/tail;
  gnoll leaf-green `#6fa843`; crab poppy red `#e04a35` (sat ≥ 65%);
  swarm warm dark umber individuals (each must read as a beetle —
  legs and shell segments visible, not blobs); skeleton bone `#e8dcbd`;
  thief deep indigo `#3a3f6e` hood; Goo glossy `#58b02e` with orange
  `#f08a1e` eyes, largest entity on screen.
- Items pop: potions/keys/blades get a 1px `#ffffff`–`#ffd9a0` glint;
  no item may be majority-gray.
- Every entity must stay readable on the new bright grass: dark
  entities need a broken sunlit rim or lighter belly/edge pixels so
  they don't sink into the `#4b7e2a` clump shade.

## 10. QA gates (run before any sheet is accepted)

Sample the **built 16×16 output tiles** (post-`build_sprites.py`,
post-tint where applicable) — never the pre-build source art:

1. Post-tint F/f/W/w inside §3 luma bands with ordering `w > F > f > W`.
2. Water tile: blue fill ≥ 70%, foam ≤ 12%, no fill pixel sat < 40%,
   no pixel in the banned teal band as fill.
3. Floor tile: no pixel with hue < 85° and sat > 75%; no speckle
   clusters (Δluma > 25 over > 3×3).
4. Nothing in a base ramp below luma 60 except the §3 whitelist.
5. Entity check at 3×: silhouette readable in 1 second, face visible,
   at least one broken light-edge outline on top/top-left, readable on
   bright grass.
6. **Render → compare against reference crops → iterate** using
   `scripts/qa_v2_scenes.py` (fixed seeds, exact render pipeline into
   `docs/`). Artists iterate on failures BEFORE submitting for
   supervisor review. No sheet reaches the supervisor without a
   side-by-side render in `docs/`.
7. Side-by-side gate: screenshot next to a reference crop — if a viewer
   calls it "gloomy", "gray", "camouflage", or "ice", it fails
   regardless of the gates above. The target sentence is: *"that looks
   like the reference village, underground."*

## 11. Consistency & originality

- All sheets share reference images as generation style input
  (`media.generate_image`, `kind: image`); same outline weight, same
  saturation level across sheets.
- Tiles flat top-down; entities/items front-facing 3/4 with visible top
  where natural.
- **All art is original: style inspiration from the references only.
  Never trace or copy their pixels, characters, buildings, or
  layouts.** Do not reproduce the village, its houses, its bridge, or
  its characters — borrow the palette, the light, and the texture
  language only.

---

# Appendix A — Entity verdicts (v2 montage → v3)

Judged from `docs/qa-v2-montage-8x.png` against the v3 spec. Verdicts are
KEEP (no redraw; touchup notes only) or REDRAW.

| Sprite | Verdict | Notes |
|---|---|---|
| chest | KEEP | Warm wood already; fits v3 browns. No touchup. |
| hero_warrior | KEEP | Readable, teal+steel matches references. Touchup: break top/top-left outline with sunlit rim per §8. |
| mob_rat | KEEP | Warm gray-brown reads on grass. Touchup: brighten pink ear/tail accents slightly. |
| mob_gnoll | KEEP | Leaf green sits in the reference grass family. No touchup. |
| mob_crab | KEEP | Poppy red pops against grass; friendly smile = reference vibe. No touchup. |
| mob_swarm | **REDRAW** | v2 reads as dark umber blobs — individuals must read as beetles (legs, shell segments). Must stay readable on bright `#5da02e` grass: add sunlit rim or lighter carapace edges. |
| mob_skeleton | KEEP | Bone white reads on any background. No touchup. |
| mob_thief | KEEP | Indigo hood reads as hostile. Touchup: ensure face/eyes visible at 3×; add broken light edge so it doesn't sink into dark clumps. |
| mob_goo | KEEP | Glossy green + orange eyes already storybook. Touchup: pillow highlight per §8. |
| potion_red / potion_strength | KEEP | Both pop; glints present. No touchup. |
| shortsword | KEEP | Steel + glint reads on grass. No touchup. |
| dart | KEEP | Readable. No touchup. |
| ration | KEEP | Golden sack fits warm palette. No touchup. |
| scroll | KEEP | Parchment reads on grass. No touchup. |

Net: entities sheet v3 regenerates **only mob_swarm**; the other 8 cells
carry over. Items sheet carries over unchanged.

# Appendix B — Sheet-by-sheet artist briefs (v3)

Pipeline facts baked in: sheets are AI-generated via the `media` tool
(`media.generate_image`) on **pure magenta `#FF00FF`** backgrounds, then
`scripts/build_sprites.py` slices cells, keys magenta → transparent,
downscales to 16×16, quantizes, and emits `src/assets/sprites.ts`.
Reference images may be passed as style input (`kind: image`). New sheet
stems: `sheet-terrain-a-v3`, `sheet-terrain-b-v3`, `sheet-entities-v3`,
`sheet-items-v3` (update `SHEETS` in `build_sprites.py` accordingly; keep
the same per-cell fill/fit modes). Format: 16 strings × 16 chars, `.`
transparent, palette-char contract unchanged. No mechanics changes
anywhere. **QA loop is mandatory: render with `scripts/qa_v2_scenes.py`
→ compare against reference crops → iterate → then submit.**

## Brief 1 — `sheet-terrain-a-v3` (3×2: floor0, wall, door, door_locked, door_secret, water)

Style prompt spine (all cells): "original 16-bit pixel-art game tile,
Secret-of-Mana-style bright sunlit storybook, chunky pixels, flat
top-down, pure magenta #FF00FF background, no text, no watermark.
Original design — do not copy any existing game's tiles."

- **floor0** (fill): smooth sunlit meadow grass. Base `#5da02e`
  (hue ~100, sat ~65%) with sparse subtle darker clumps `#4b7e2a`
  (Δluma ≤ 12), rare single-pixel light blades `#7cc24a`, 1–2 tiny
  white/yellow flower dots per tile max. **BANS: no neon-lime
  (hue<85 & sat>75%), no camo speckle clusters, no stone texture —
  this is grass, not flagstone.**
- **wall** (fill): dirt cliff face. Bottom ~2/3 warm brown earth
  `#6e4c2c` with thin horizontal strata `#5a3d24` and sparse small
  stones/roots; top ~1/3 sunlit grass cap `#74b53a` with a 1px darker
  lip `#4f8a2a` at the transition. Full-bleed, no outer outline.
- **door** (fill): wooden plank door `#a8763f` with `#7a4f2a` plank
  lines, iron hinges, set in an earth/grass surround matching wall
  tones. Warm, inviting.
- **door_locked** (fill): same door + heavy iron bands and a prominent
  lock plate; lock glints `#ffd9a0`. Must read "locked" at 3×.
- **door_secret** (fill): must look like the **wall** tile — same
  grass cap, same dirt face. Only tell: a faint 1px `#2b2226` seam
  and a tiny iron ring. (Stays in the tintable gray ramp like wall so
  `REGION_TINTS` treats it identically.)
- **water** (fill): saturated BLUE `#1080c0` fill ≥ 70% of tile, deep
  pockets `#003f66` ≤ 15%, light glints `#2a9ad6`, thin white edge
  arcs + 1–2 sparkles `#7cc8ef` totaling ≤ 12% white. **BANS: no
  fill pixel with sat < 40%; no teal fill; no white wash. This is a
  river, not ice.**

## Brief 2 — `sheet-terrain-b-v3` (3×2: grass, chasm, stairs_down, stairs_up, trap_revealed, well)

- **grass** (fill): lush tall-grass tufts on the `#5da02e` base —
  denser and taller than floor0's clumps, a few flower dots, clearly
  "vegetation tile" vs floor0's "ground tile". Same bans as floor0.
- **chasm** (fill): dark earthen fissure. Core `#0d0b10` void, inner
  `#1a1418`, 1px warm rim `#2b2226`, sparse warm earth glints
  `#4a3828`. Darkest tile in the scene; irregular organic edges.
- **stairs_down** (fill): warm sandstone steps descending into
  darkness — base `#9a8a70`, shade `#6b5a44`, light `#c0b090`;
  the downward opening small, ringed `#2b2226`.
- **stairs_up** (fill): same sandstone, steps rising toward the
  viewer, brightest step `#e8dcc0` at top.
- **trap_revealed** (fill): warning-red pressure plate `#e04434`
  with near-white metal teeth `#f6efdb` + `#ffd9a0` glints, dark
  warm outline. Must be the most alarming tile in the scene.
- **well** (fit): stone-ring well — warm gray-brown stones
  `#9a8a70`/`#6b5a44`, wooden A-frame `#a8763f`, dark pit interior
  (small, rimmed `#2b2226`). Centered on transparency.

## Brief 3 — `sheet-entities-v3` (3×3: chest, hero_warrior, mob_rat, mob_gnoll, mob_crab, mob_swarm, mob_skeleton, mob_thief, mob_goo)

**Only mob_swarm is redrawn** (see Appendix A). The other 8 cells carry
over from v2. Regenerate the full sheet for pipeline consistency, but
the art target for the 8 keepers is "identical to v2, plus §8 sunlit
rim touchups where noted". Brief for the one redraw:

- **mob_swarm** (fit): a cluster of 3–4 small beetles, warm dark
  umber `#4a382c` bodies with visible legs, shell segments, and
  sunlit carapace rims so each beetle reads individually on bright
  grass. No blob clusters. Each beetle identifiable at 16×16.

## Brief 4 — `sheet-items-v3` (3×2: shortsword, dart, potion_red, potion_strength, ration, scroll)

**All six KEEP from v2 — no redraw required.** Regenerate only if the
pipeline needs a fresh sheet; art target is "identical to v2".
Items already pop on bright backgrounds (white/gold glints, warm
outlines) and sit in the reference palette.

## Code-side changes the supervisor must land with v3 sheets

1. `REGION_TINTS.sewers` → §5 values (`F #5da02e`, `f #4b7e2a`,
   `W #6e4c2c`, `w #74b53a`).
2. Cap `scripts/stamp_ripples.py` so stamped foam stays within the
   §6 12% white budget (the v2 ≥20% ripple behavior is what made ice).
3. `SHEETS` stems in `build_sprites.py` → `-v3` names.
