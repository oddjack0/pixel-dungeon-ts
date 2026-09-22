import { Grid } from '../core/grid.js';
import { findPath } from '../core/path.js';
import type { Game } from './loop.js';
import type { HeroIntent } from './seams.js';

/**
 * Keyboard + pointer input. Produces HeroIntents and feeds them to the Game;
 * the Game (via MechanicsHooks) decides what they do. UI panels attach via
 * the onToggle* callbacks (owned by the UI designer).
 *
 * Keys: arrows / WASD / QEZC = 8-dir move, Space or . = wait, G = pickup,
 * F = search for secrets, M = minimap, I = inventory, > = descend, < = ascend.
 * Tap/click: adjacent enemy = attack, adjacent NPC = talk, stairs underfoot
 * = use, else A* path.
 */
export class InputHandler {
  onToggleMinimap: () => void = () => {};
  onToggleInventory: () => void = () => {};

  private game: Game | null = null;
  private screenToTile: ((sx: number, sy: number) => { x: number; y: number }) | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private detachFns: Array<() => void> = [];

  attach(
    canvas: HTMLCanvasElement,
    screenToTile: (sx: number, sy: number) => { x: number; y: number },
    game: Game,
  ): void {
    this.detach();
    this.canvas = canvas;
    this.screenToTile = screenToTile;
    this.game = game;

    const onKey = (e: KeyboardEvent): void => this.handleKey(e);
    const onPointer = (e: PointerEvent): void => {
      const t = this.screenToTile;
      const g = this.game;
      if (!t || !g) return;
      const tile = t(e.clientX, e.clientY);
      this.handleTileTap(tile.x, tile.y);
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointer);
    this.detachFns = [
      () => window.removeEventListener('keydown', onKey),
      () => canvas.removeEventListener('pointerdown', onPointer),
    ];
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.game = null;
    this.screenToTile = null;
    this.canvas = null;
  }

  handleKey(e: KeyboardEvent): void {
    const game = this.game;
    if (!game || game.gameOver) return;
    const k = e.key;

    const move = DIRS[k.toLowerCase()];
    if (move) {
      e.preventDefault();
      game.queueIntent({ kind: 'move', dx: move[0], dy: move[1] });
      return;
    }
    switch (k) {
      case ' ':
      case '.':
        e.preventDefault();
        game.queueIntent({ kind: 'wait' });
        break;
      case 'g':
      case 'G':
        game.queueIntent({ kind: 'pickup' });
        break;
      case 'f':
      case 'F':
        // Intentional search (Hero.search(true), Hero.java:1295): reveals
        // secret doors within radius 1, costs 2 turns.
        game.queueIntent({ kind: 'search' });
        break;
      case 'm':
      case 'M':
        this.onToggleMinimap();
        break;
      case 'i':
      case 'I':
        this.onToggleInventory();
        break;
      case '>':
        game.queueIntent({ kind: 'descend' });
        break;
      case '<':
        game.queueIntent({ kind: 'ascend' });
        break;
      default:
        break;
    }
  }

  /** Tap/click a tile: attack adjacent mob, use stairs, or path there. */
  handleTileTap(tx: number, ty: number): void {
    const game = this.game;
    if (!game || game.gameOver) return;
    const { level, hero } = game;
    if (!level.inBounds(tx, ty)) return;

    // Tapping the hero waits a turn.
    if (tx === hero.x && ty === hero.y) {
      game.queueIntent({ kind: 'wait' });
      return;
    }

    // Tapping an adjacent mob attacks it — or talks to it when it is an NPC
    // (vanilla Hero.actInteract: adjacent taps on talkable NPCs talk).
    const mob = level.mobAt(tx, ty);
    if (mob && Grid.chebyshev(tx, ty, hero.x, hero.y) === 1) {
      const live = game.mobs.find((m) => m.id === mob.id);
      if (live) {
        if (typeof live.onTalk === 'function') {
          game.queueIntent({ kind: 'talk', targetId: live.id } satisfies HeroIntent);
        } else {
          game.queueIntent({ kind: 'attack', targetId: live.id } satisfies HeroIntent);
        }
      }
      return;
    }

    // Tapping stairs while standing on them uses them.
    const here = level.idx(hero.x, hero.y);
    const tapped = level.idx(tx, ty);
    if (tapped === level.stairsDown && here === level.stairsDown) {
      game.queueIntent({ kind: 'descend' });
      return;
    }
    if (tapped === level.stairsUp && here === level.stairsUp) {
      game.queueIntent({ kind: 'ascend' });
      return;
    }

    // Otherwise: A* tap-to-move, one step per hero turn.
    const path = findPath(
      level,
      (x, y) => level.isPassable(x, y) && !level.mobAt(x, y),
      hero.x,
      hero.y,
      tx,
      ty,
    );
    if (!path || path.length === 0) {
      if (tx !== hero.x || ty !== hero.y) game.logMsg('No route there.');
      game.cancelPath();
      return;
    }
    game.setPath(path);
  }
}

/** Key -> [dx, dy]. Lowercased before lookup. */
const DIRS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
};
