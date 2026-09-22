/**
 * UiManager: owns all UI state and wires it to the engine.
 *
 * - Reads the central Game (engine/loop.ts); never duplicates state.
 * - Attaches to engine/input.ts via onToggleMinimap / onToggleInventory.
 * - Owns the rAF loop: turn pacing, renderer, then UI overlays on top.
 * - Capture-phase window handlers route taps/keys to panels and screens
 *   before input.ts sees them (stopPropagation keeps game input clean).
 *
 * Boot: title screen first; New Run / Continue / seed entry; death screen
 * on game over; pause + help overlays.
 */
import { contentLevelGen } from '../content/spawns.js';
import { contentMechanics } from '../content/hooks.js';
import { Game } from '../engine/loop.js';
import { Renderer } from '../engine/render.js';
import { InputHandler } from '../engine/input.js';
import { clearSave, hasSave, loadGame, saveGame } from '../engine/save.js';
import { readHeroView } from './heroView.js';
import { Hud } from './hud.js';
import { doItemAction, InventoryPanel, readInventory } from './inventory.js';
import { Minimap } from './minimap.js';
import { Screens, type RunSummary } from './screens.js';
import { ShopPanel, type ShopTab } from './shop.js';
import { Effects } from './effects.js';
import { inRect, roundRect, UI, type View } from './palette.js';
import {
  Dialogs,
  dialogOpen,
  uiBridge,
} from './dialog.js';

const HERO_MS = 110; // at most one hero-visible action per 110ms

export class UiManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;
  private readonly input = new InputHandler();

  private readonly hud = new Hud();
  private readonly inventory = new InventoryPanel();
  private readonly shop = new ShopPanel();
  private readonly dialogs = new Dialogs();
  private readonly minimap = new Minimap();
  private readonly screens = new Screens();
  private readonly effects = new Effects();

  private game: Game | null = null;
  private throwMode: { slot: number } | null = null;
  private kills = 0;
  private lastHeroAct = 0;
  private view: View = { w: 390, h: 700 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('UiManager: 2d context unavailable');
    this.ctx = ctx;
    this.renderer = new Renderer(canvas);

    // Panel toggles (engine/input.ts attach points).
    this.input.onToggleMinimap = () => {
      if (this.screens.state === 'playing') this.minimap.toggle();
    };
    this.input.onToggleInventory = () => {
      if (this.screens.state === 'playing') this.inventory.toggle();
    };
    this.inventory.onThrowRequest = (item) => {
      this.throwMode = { slot: item.slot };
      this.inventory.close();
    };
    this.effects.onMobDeath = () => {
      this.kills++;
    };

    // Quest dialogs: the uiBridge carries openShop for the shopkeeper's
    // onTalk path (src/content/npcs.ts ShopkeeperMob).
    uiBridge.current = { openShop: (mode) => this.openShop(mode) };

    // Screens lifecycle.
    this.screens.onStartRun = (seed) => this.startRun(seed);
    this.screens.onContinue = () => this.continueRun();
    this.screens.onQuitToTitle = () => this.quitToTitle(true);
    this.screens.onAbandonRun = () => this.quitToTitle(false);
    this.screens.hasSave = () => hasSave();
    this.screens.getSummary = (): RunSummary | null => this.deathSummary();

    window.addEventListener('keydown', (e) => this.handleKeyCapture(e), true);
    window.addEventListener('pointerdown', (e) => this.handleTapCapture(e), true);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (this.game && !this.game.gameOver) {
          saveGame(this.game, contentMechanics);
          this.game.logMsg('Game saved.');
        }
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.game && !this.game.gameOver) {
        saveGame(this.game, contentMechanics);
      }
    });
  }

  boot(defaultSeed?: string): void {
    if (defaultSeed !== undefined && defaultSeed !== '') this.screens.seedText = defaultSeed;
    const frame = (t: number): void => {
      this.tick(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /**
   * Opens the shop trade screen. This is the `openShop` half of the
   * ShopTalkCtx contract (src/content/shopkeeper.ts): the quest worker wires
   * NPC click/tap to `new Shopkeeper().onTalk({ game, openShop: (m) =>
   * ui.openShop(m) })`.
   */
  openShop(mode: ShopTab = 'buy'): void {
    if (this.screens.state === 'playing' && this.game && !this.game.gameOver) {
      this.shop.openShop(mode);
    }
  }

  /** True while the shop trade screen is open (for the NPC talk router). */
  get shopOpen(): boolean {
    return this.shop.open;
  }

  // --- run lifecycle ---

  private startRun(seed: number): void {
    clearSave();
    this.kills = 0;
    this.game = new Game(seed >>> 0, { gen: contentLevelGen, mechanics: contentMechanics });
    this.input.attach(this.canvas, (sx, sy) => this.renderer.screenToTile(sx, sy), this.game);
    this.hud.logBuffer.reset();
    this.effects.reset();
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show('playing');
  }

  private continueRun(): void {
    const g = loadGame(contentMechanics);
    if (!g) return; // no valid save; title stays (Continue is disabled anyway)
    this.kills = 0;
    this.game = g;
    this.input.attach(this.canvas, (sx, sy) => this.renderer.screenToTile(sx, sy), g);
    this.hud.logBuffer.reset();
    this.hud.logBuffer.sync(g.log);
    this.effects.reset();
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show('playing');
  }

  private quitToTitle(save: boolean): void {
    if (this.game && save && !this.game.gameOver) saveGame(this.game, contentMechanics);
    this.input.detach();
    this.game = null;
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show('title');
  }

  private deathSummary(): RunSummary | null {
    const g = this.game;
    if (!g) return null;
    const hv = readHeroView(g);
    return {
      cause: this.deathCause(g),
      depth: g.level.depth,
      turns: g.turnCount,
      lvl: hv.lvl,
      kills: this.kills,
      gold: hv.gold,
      seed: g.seed,
    };
  }

  private deathCause(g: Game): string {
    for (let i = g.log.length - 1; i >= Math.max(0, g.log.length - 20); i--) {
      const line = g.log[i];
      // Matches the vanilla buff death lines ("You burned to death...",
      // "You died from poison...", "Caustic ooze killed you...") as well as
      // the generic fallback.
      if (/killed by|slain|you died|to death\.\.\.|killed you\.\.\./i.test(line)) return line;
    }
    return 'The dungeon claims another.';
  }

  // --- input routing (capture phase) ---

  private handleKeyCapture(e: KeyboardEvent): void {
    const st = this.screens.state;
    if (st !== 'playing') {
      if (this.screens.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Quest dialog modal: captures all keys while open (vanilla windows are
    // blocking — the game cannot be controlled behind them).
    if (dialogOpen()) {
      if (this.dialogs.handleKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const k = e.key;
    if (this.throwMode && (k === 'Escape' || k.toLowerCase() === 'p')) {
      this.throwMode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.inventory.open) {
      if (k === 'Escape' || k.toLowerCase() === 'i') {
        this.inventory.close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (k.toLowerCase() === 'm') return; // let minimap toggle through
      if (isGameKey(k)) {
        e.preventDefault();
        e.stopPropagation(); // modal: don't walk while picking items
      }
      return;
    }
    if (this.shop.open) {
      if (k === 'Escape') {
        this.shop.close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (isGameKey(k)) {
        e.preventDefault();
        e.stopPropagation(); // modal: don't walk while trading
      }
      return;
    }
    if (k === 'Escape' || k.toLowerCase() === 'p') {
      this.screens.show('paused');
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private handleTapCapture(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const st = this.screens.state;
    if (st !== 'playing') {
      if (this.screens.handleTap(x, y)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const g = this.game;
    if (!g || g.gameOver) return;

    // Quest dialog modal: captures all taps while open.
    if (dialogOpen()) {
      if (this.dialogs.handleTap(x, y)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Inventory modal consumes everything.
    if (this.inventory.open) {
      this.inventory.handleTap(x, y, g);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Shop modal consumes everything.
    if (this.shop.open) {
      this.shop.handleTap(x, y, g);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Throw targeting: next tap picks the target.
    if (this.throwMode) {
      const t = this.renderer.screenToTile(e.clientX, e.clientY);
      const mob = g.level.mobAt(t.x, t.y);
      if (mob) {
        const live = g.mobs.find((m) => m.id === mob.id);
        if (live) g.queueIntent({ kind: 'throwItem', slot: this.throwMode.slot, targetId: live.id });
        else g.logMsg('Nothing to throw at.');
      } else {
        g.logMsg('Throw cancelled.');
      }
      this.throwMode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Quick-action slots.
    const L = this.hud.layout(this.view);
    if (inRect(L.potionBtn, x, y)) {
      const potion = readInventory(g).find((i) => i.kind === 'potion');
      if (potion) doItemAction(g, potion, 'use');
      else g.logMsg('You have no potions.');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (inRect(L.dartBtn, x, y)) {
      const darts = readInventory(g).find((i) => i.kind === 'missile' && i.qty > 0);
      if (darts) {
        this.throwMode = { slot: darts.slot };
        g.logMsg('Tap a target to throw a dart.');
      } else {
        g.logMsg('You have no darts.');
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Otherwise the tap falls through to engine/input.ts (move/attack/path).
  }

  // --- frame ---

  private tick(t: number): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const g = this.game;

    if (g && this.screens.state === 'playing' && !g.gameOver && !dialogOpen()) {
      // Turn pacing: at most one hero-visible action per 110ms; mobs drain.
      // A quest dialog pauses the simulation (vanilla modal windows block
      // the game loop).
      let guard = 500;
      for (;;) {
        const next = g.scheduler.peek();
        if (!next) break;
        const heroTurn = next === g.hero;
        if (heroTurn && t - this.lastHeroAct < HERO_MS) break;
        const r = g.pump();
        if (r !== 'acted') break;
        if (heroTurn) this.lastHeroAct = t;
        if (--guard <= 0) break;
      }
      this.hud.logBuffer.sync(g.log);
      this.effects.watch(g, nowMs);
      if (g.gameOver) this.screens.show('dead');
    }

    const { ctx } = this;
    // Single source of truth for canvas geometry: the renderer's per-frame
    // sync (backing store = CSS size x dpr). UI layout and the dungeon view
    // must use the same numbers or they can disagree (dungeon small in a
    // corner while the HUD spans the window).
    this.renderer.syncSize();
    this.view = this.renderer.viewSize();
    const dpr = this.renderer.pixelRatio();
    if (g) {
      this.renderer.render(g);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const toScreen = (tx: number, ty: number): { x: number; y: number } =>
        this.renderer.tileToScreen(tx, ty);
      this.effects.draw(ctx, g, toScreen, this.view, nowMs);
      this.hud.draw(ctx, g, this.renderer, this.view, { throwMode: this.throwMode !== null });
      this.minimap.draw(ctx, g, this.view, nowMs);
      this.inventory.draw(ctx, g, this.renderer, this.view);
      this.shop.draw(ctx, g, this.renderer, this.view);
      // Quest dialogs render above every other overlay.
      if (dialogOpen()) this.dialogs.draw(ctx, this.renderer, this.view);
      if (this.throwMode) this.drawThrowHint(ctx);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = UI.backdrop;
      ctx.fillRect(0, 0, this.view.w, this.view.h);
    }
    if (this.screens.state !== 'playing') {
      this.screens.draw(ctx, this.renderer, this.view, nowMs);
    }
  }

  private drawThrowHint(ctx: CanvasRenderingContext2D): void {
    const label = 'Tap a target to throw · Esc cancels';
    ctx.font = 'bold 13px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 28;
    const r = { x: (this.view.w - w) / 2, y: 70, w, h: 34 };
    ctx.fillStyle = 'rgba(10, 8, 14, 0.85)';
    ctx.strokeStyle = UI.gold;
    ctx.lineWidth = 2;
    roundRect(ctx, r, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/** Keys the engine consumes as game input (swallowed while a modal is open). */
function isGameKey(k: string): boolean {
  const l = k.toLowerCase();
  if (l.length === 1 && 'wasdqezc .g<>'.includes(l)) return true;
  return k.startsWith('Arrow');
}
