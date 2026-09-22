import { describe, test, expect } from "bun:test";
import {
  ART_PX,
  PALETTE,
  REGION_TINTS,
  SPRITES,
  validateSprites,
} from "../src/assets/sprites.js";

const EXPECTED_KEYS = [
  "hero", "hero_warrior",
  "floor0", "floor1", "wall",
  "door", "door_locked", "door_secret",
  "water", "grass", "chasm",
  "stairs_up", "stairs_down", "trap_revealed", "well", "chest",
  "mob_rat", "mob_gnoll", "mob_crab", "mob_swarm", "mob_skeleton",
  "mob_thief", "mob_goo",
  "shortsword", "dart", "potion_red", "potion_strength", "ration", "scroll",
  "armor_cloth", "gold", "key_iron", "key_skeleton",
];

describe("sprites atlas", () => {
  test("validateSprites reports no problems", () => {
    expect(validateSprites()).toEqual([]);
  });

  test("all M1 sprite keys exist", () => {
    for (const k of EXPECTED_KEYS) {
      expect(SPRITES[k], `missing sprite: ${k}`).toBeDefined();
    }
  });

  test("hero is the warrior alias", () => {
    expect(SPRITES["hero"]).toEqual(SPRITES["hero_warrior"]);
  });

  test("every sprite is 16x16 over the palette", () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      expect(rows.length, `${name} rows`).toBe(ART_PX);
      for (const row of rows) {
        expect(row.length, `${name} cols`).toBe(ART_PX);
        for (const ch of row) {
          expect(ch in PALETTE, `${name} char '${ch}'`).toBe(true);
        }
      }
    }
  });

  test("tintable ramp chars are used by floor/wall/secret-door", () => {
    for (const name of ["floor0", "floor1", "wall", "door_secret"]) {
      const chars = new Set(SPRITES[name].join("").split(""));
      expect(chars.has("F") || chars.has("f") || chars.has("W") || chars.has("w")).toBe(true);
    }
  });

  test("REGION_TINTS covers 5 regions incl. sewers", () => {
    for (const r of ["sewers", "prison", "caves", "city", "halls"]) {
      expect(REGION_TINTS[r], `missing region ${r}`).toBeDefined();
      for (const ch of ["F", "f", "W", "w"]) {
        expect(REGION_TINTS[r][ch], `${r}.${ch}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
