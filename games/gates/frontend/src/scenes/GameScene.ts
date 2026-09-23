import Phaser from 'phaser';
import { api, newRoundId } from '../api';
import { PALETTE, SYMBOL_META, generateBackground, generatePanel, generateSymbolTextures } from '../art';
import type { Board, RoundResponse, SpinResult, SymbolId } from '../../../shared/types';
import { REELS, ROWS } from '../../../shared/types';


interface Cell {
  bg: Phaser.GameObjects.Image;
  sym: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;
}

export class GameScene extends Phaser.Scene {
  private cells: Cell[][] = [];
  private gridX = 0; private gridY = 0; private cellSize = 0; private gap = 0;

  private balance = 0;
  private stakeIndex = 0;
  private stakeLevels: number[] = [20];
  private buyMultiplier = 100;
  private busy = false;
  private soundOn = true;
  private testMode = false;
  private vectors: string[] = [];
  private pendingVector: string | undefined;
  private zeusImage?: Phaser.GameObjects.Image;
  private readonly devMode = window.location.pathname === '/dev/test-harness';

  private txtBalance!: Phaser.GameObjects.Text;
  private txtStake!: Phaser.GameObjects.Text;
  private txtWin!: Phaser.GameObjects.Text;
  private txtStatus!: Phaser.GameObjects.Text;
  private txtMultiplier!: Phaser.GameObjects.Text;
  private multPanel!: Phaser.GameObjects.Container;
  private fsPanel!: Phaser.GameObjects.Container;
  private txtFsCount!: Phaser.GameObjects.Text;
  private btnSpin!: Phaser.GameObjects.Container;
  private btnBuy!: Phaser.GameObjects.Container;
  private spinLabel!: Phaser.GameObjects.Text;
  private audio?: AudioContext;
  private isPortrait = false;

  /** design-space dimensions, set by the Phaser scale config in main.ts */
  private get DW(): number { return this.scale.width; }
  private get DH(): number { return this.scale.height; }

  constructor() { super('Game'); }

  preload(): void {
    generateSymbolTextures(this, 160);
    this.load.image('gates-bg', '/gates/background.png');
    this.load.image('gates-low-1', '/gates/low-1.png');
    this.load.image('gates-low-2', '/gates/low-2.png');
    this.load.image('gates-low-3', '/gates/low-3.png');
    this.load.image('gates-low-4', '/gates/low-4.png');
    this.load.image('gates-low-5', '/gates/low-5.png');
    this.load.image('gates-high-1', '/gates/high-1.png');
    this.load.image('gates-high-2', '/gates/high-2.png');
    this.load.image('gates-high-3', '/gates/high-3.png');
    this.load.image('gates-high-4', '/gates/high-4.png');
    this.load.image('gates-scatter', '/gates/scatter.png');
    this.load.image('gates-bonus', '/gates/bonus.png');
    this.load.image('gates-zeus', '/gates/zeus-idle.avif');
    this.load.image('gates-zeus-cast', '/gates/zeus-cast.avif');
    this.load.audio('gates-spin', '/gates/spin-start.web.ogg');
    this.load.audio('gates-win', '/gates/win.web.ogg');
    this.load.audio('gates-multiplier', '/gates/win-multiplier.web.ogg');
    this.load.audio('gates-feature', '/gates/feature-start.web.ogg');
  }

  async create(): Promise<void> {
    this.isPortrait = this.DH > this.DW;
    this.buildBackground();
    this.buildGrid();
    this.buildUI();

    try {
      const cfg = await api.config();
      this.stakeLevels = cfg.stakeLevels;
      this.buyMultiplier = cfg.buyBonusMultiplier;
      this.testMode = cfg.testMode;
      this.vectors = cfg.vectors;
      if (this.devMode) {
        this.pendingVector = new URLSearchParams(window.location.search).get('vector') ?? undefined;
      }
      this.balance = await api.balance();
      this.refreshHud();
      this.setStatus('Select a bet and spin');
      if (this.devMode && this.testMode) this.buildTestPanel();
    } catch {
      this.setStatus('Backend offline - start the server on :8787');
    }

    this.fillBoard(this.randomLookingBoard());
  }

  /* ------------------------------------------------------------ layout */

  private buildBackground(): void {
    generateBackground(this, this.DW, this.DH);
    const bg = this.add.image(this.DW / 2, this.DH / 2, 'gates-bg');
    bg.setDisplaySize(this.DW, this.DH);
    bg.setDepth(-10);

    this.zeusImage = this.add.image(
      this.isPortrait ? this.DW - 78 : this.DW - 175,
      this.isPortrait ? 244 : 420,
      'gates-zeus',
    );
    this.zeusImage.setDisplaySize(this.isPortrait ? 142 : 330, this.isPortrait ? 255 : 550);
    this.zeusImage.setAlpha(0.96).setDepth(-5);
  }

  private buildGrid(): void {
    const portrait = this.isPortrait;
    this.cellSize = portrait ? 70 : 98;
    this.gap = portrait ? 7 : 9;
    const gw = REELS * this.cellSize + (REELS - 1) * this.gap;
    const gh = ROWS * this.cellSize + (ROWS - 1) * this.gap;
    this.gridX = portrait ? this.DW / 2 - gw / 2 : 320;
    this.gridY = portrait ? 292 : 214;

    // grid frame
    const pad = portrait ? 12 : 18;
    generatePanel(this, 'gridPanel', gw + pad * 2, gh + pad * 2,
      'rgba(14,9,30,0.74)', 'rgba(245,196,81,0.42)', 22);
    this.add.image(this.DW / 2, this.gridY + gh / 2, 'gridPanel').setDepth(-2);

    for (let reel = 0; reel < REELS; reel++) {
      this.cells[reel] = [];
      for (let row = 0; row < ROWS; row++) {
        const x = this.gridX + reel * (this.cellSize + this.gap) + this.cellSize / 2;
        const y = this.gridY + row * (this.cellSize + this.gap) + this.cellSize / 2;

        const container = this.add.container(x, y);
        const bg = this.add.image(0, 0, 'cell').setDisplaySize(this.cellSize, this.cellSize);
        const glow = this.add.image(0, 0, 'cellWin').setDisplaySize(this.cellSize, this.cellSize).setAlpha(0);
        const sym = this.add.image(0, 0, 'sym-PYRITE')
          .setDisplaySize(this.cellSize * 0.99, this.cellSize * 0.99);
        const label = this.add.text(0, this.cellSize * 0.26, '', {
          fontFamily: 'Trebuchet MS', fontSize: `${Math.round(this.cellSize * 0.24)}px`,
          color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5).setAlpha(0);
        label.setShadow(0, 2, '#2a0d4a', 4, true, true);

        container.add([bg, glow, sym, label]);
        this.cells[reel][row] = { bg, sym, glow, label, container };
      }
    }

    // mask so tumbling symbols do not draw outside the grid
    const maskG = this.make.graphics({ x: 0, y: 0 });
    maskG.fillStyle(0xffffff);
    maskG.fillRoundedRect(this.gridX - 4, this.gridY - 4, gw + 8, gh + 8, 14);
    const mask = maskG.createGeometryMask();
    for (const col of this.cells) for (const c of col) c.container.setMask(mask);
  }

  private mkButton(
    x: number, y: number, w: number, h: number, label: string,
    onClick: () => void, variant: 'primary' | 'ghost' | 'gold' = 'ghost',
  ): Phaser.GameObjects.Container {
    const key = `btn-${variant}-${w}x${h}`;
    if (!this.textures.exists(key)) {
      const fill = variant === 'primary' ? 'rgba(110,242,192,0.16)'
        : variant === 'gold' ? 'rgba(245,196,81,0.18)' : 'rgba(40,26,78,0.86)';
      const edge = variant === 'primary' ? 'rgba(110,242,192,0.85)'
        : variant === 'gold' ? 'rgba(245,196,81,0.85)' : 'rgba(150,125,225,0.5)';
      generatePanel(this, key, w, h, fill, edge, Math.min(h / 2, 26));
    }
    const img = this.add.image(0, 0, key);
    const color = variant === 'primary' ? '#8dffd5' : variant === 'gold' ? '#ffd98a' : '#e3dbff';
    const txt = this.add.text(0, 0, label, {
      fontFamily: 'Trebuchet MS', fontSize: `${Math.round(h * 0.36)}px`,
      color, fontStyle: 'bold',
    }).setOrigin(0.5);
    const c = this.add.container(x, y, [img, txt]);
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => img.setAlpha(0.82));
    c.on('pointerout', () => img.setAlpha(1));
    c.on('pointerdown', () => { c.setScale(0.96); this.blip(520, 0.04); });
    c.on('pointerup', () => { c.setScale(1); onClick(); });
    (c as any).labelText = txt;
    return c;
  }

  private buildUI(): void {
    const P = this.isPortrait;
    const cx = this.DW / 2;

    /* ---------------- integrated slot banner ---------------- */
    const title = this.add.text(cx, P ? 54 : 48, 'WIN UP TO 15000 X BET', {
      fontFamily: 'Georgia, Trebuchet MS', fontSize: P ? '18px' : '34px',
      color: '#f5c451', fontStyle: 'bold',
    }).setOrigin(0.5);
    title.setShadow(0, 4, '#1a0b33', 10, true, true);
    this.tweens.add({
      targets: title, scale: { from: 1, to: 1.02 },
      duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    /* ---------------- win counter ---------------- */
    const winW = P ? 300 : 420;
    const winH = P ? 54 : 64;
    const winY = P ? 142 : 124;
    generatePanel(this, 'winPanel', winW, winH, 'rgba(14,9,30,0.8)', 'rgba(245,196,81,0.45)', 20);
    this.add.image(cx, winY, 'winPanel');
    this.txtWin = this.add.text(cx, winY, 'WIN  0', {
      fontFamily: 'Trebuchet MS', fontSize: P ? '26px' : '34px',
      color: '#ffd98a', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.txtStatus = this.add.text(cx, winY + (P ? 30 : 42), '', {
      fontFamily: 'Trebuchet MS', fontSize: P ? '15px' : '19px', color: '#a89ccb',
    }).setOrigin(0.5);

    /* ---------------- feature badges ---------------- */
    const badgeW = P ? 132 : 190;
    const badgeH = P ? 48 : 62;
    const badgeY = P ? 232 : winY;
    generatePanel(this, 'multPanel', badgeW, badgeH, 'rgba(70,24,120,0.9)', 'rgba(195,107,255,0.9)', 18);
    this.txtMultiplier = this.add.text(0, 0, 'x0', {
      fontFamily: 'Trebuchet MS', fontSize: P ? '24px' : '32px', color: '#e9c6ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.multPanel = this.add.container(P ? cx - 78 : 250, badgeY,
      [this.add.image(0, 0, 'multPanel'), this.txtMultiplier]).setAlpha(0);

    generatePanel(this, 'fsPanel', badgeW, badgeH, 'rgba(24,70,60,0.9)', 'rgba(110,242,192,0.9)', 18);
    this.txtFsCount = this.add.text(0, 0, '0 / 0', {
      fontFamily: 'Trebuchet MS', fontSize: P ? '22px' : '28px', color: '#8dffd5', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.fsPanel = this.add.container(P ? cx + 78 : this.DW - 345, badgeY,
      [this.add.image(0, 0, 'fsPanel'), this.txtFsCount]).setAlpha(0);

    /* ---------------- bottom bar ---------------- */
    if (P) {
      const barH = 210;
      const barY = this.DH - barH / 2 - 18;
      generatePanel(this, 'bar', 452, barH, 'rgba(12,8,26,0.92)', 'rgba(150,125,225,0.32)', 24);
      this.add.image(cx, barY, 'bar');

      const rowA = barY - 62;
      // balance (left)
      this.add.text(cx - 112, rowA - 18, 'BALANCE', {
        fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#8f83b5',
      }).setOrigin(0.5);
      this.txtBalance = this.add.text(cx - 112, rowA + 8, '0', {
        fontFamily: 'Trebuchet MS', fontSize: '22px', color: '#f3eefc', fontStyle: 'bold',
      }).setOrigin(0.5);

      // stake (right)
      this.add.text(cx + 104, rowA - 18, 'STAKE', {
        fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#8f83b5',
      }).setOrigin(0.5);
      this.txtStake = this.add.text(cx + 104, rowA + 8, '20', {
        fontFamily: 'Trebuchet MS', fontSize: '22px', color: '#ffd98a', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.mkButton(cx + 46, rowA + 2, 42, 42, '−', () => this.changeStake(-1));
      this.mkButton(cx + 162, rowA + 2, 42, 42, '+', () => this.changeStake(1));

      // actions
      const rowB = barY + 34;
      this.btnBuy = this.mkButton(cx - 118, rowB, 192, 62, 'BUY SPINS', () => void this.doSpin(true), 'gold');
      this.btnSpin = this.mkButton(cx + 92, rowB, 152, 62, 'SPIN', () => void this.doSpin(false), 'primary');
      this.spinLabel = (this.btnSpin as any).labelText;

      const rowC = barY + 86;
      this.mkButton(cx - 60, rowC, 92, 34, 'AUTO', () => {
        this.setStatus('Autoplay UI is visual-only in this POC');
      });
      this.mkButton(cx + 60, rowC, 92, 34, '♪ SOUND', () => {
        this.soundOn = !this.soundOn;
        this.setStatus(this.soundOn ? 'Sound on' : 'Sound off');
      });
    } else {
      // A dedicated feature rail keeps the game controls inside the slot frame.
      generatePanel(this, 'featureRail', 210, 455, 'rgba(12,8,26,0.88)', 'rgba(245,196,81,0.5)', 24);
      this.add.image(126, 430, 'featureRail');
      this.add.text(126, 230, 'FEATURE', {
        fontFamily: 'Georgia', fontSize: '18px', color: '#ffd98a', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add.text(126, 262, 'BUY FREE SPINS', {
        fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#e8e3f2', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.btnBuy = this.mkButton(126, 312, 174, 64, 'BUY SPINS',
        () => void this.doSpin(true), 'gold');
      this.add.text(126, 382, 'BET', {
        fontFamily: 'Trebuchet MS', fontSize: '14px', color: '#8f83b5', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add.text(126, 414, 'CHANCE FEATURE', {
        fontFamily: 'Trebuchet MS', fontSize: '11px', color: '#8f83b5',
      }).setOrigin(0.5);
      this.mkButton(126, 468, 126, 40, 'INFO', () => this.setStatus('Feature rules'), 'ghost');

      const barY = this.DH - 82;
      generatePanel(this, 'bar', 1040, 118, 'rgba(12,8,26,0.94)', 'rgba(245,196,81,0.42)', 26);
      this.add.image(850, barY, 'bar');

      this.add.text(420, barY - 20, 'CREDIT', {
        fontFamily: 'Trebuchet MS', fontSize: '16px', color: '#8f83b5',
      }).setOrigin(0.5);
      this.txtBalance = this.add.text(420, barY + 12, '0', {
        fontFamily: 'Trebuchet MS', fontSize: '30px', color: '#f3eefc', fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(650, barY - 20, 'BET', {
        fontFamily: 'Trebuchet MS', fontSize: '16px', color: '#8f83b5',
      }).setOrigin(0.5);
      this.txtStake = this.add.text(650, barY + 12, '20', {
        fontFamily: 'Trebuchet MS', fontSize: '30px', color: '#ffd98a', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.mkButton(575, barY + 4, 52, 52, '−', () => this.changeStake(-1));
      this.mkButton(725, barY + 4, 52, 52, '+', () => this.changeStake(1));

      this.btnSpin = this.mkButton(930, barY, 210, 74, 'SPIN',
        () => void this.doSpin(false), 'primary');
      this.spinLabel = (this.btnSpin as any).labelText;

      this.mkButton(1080, barY - 42, 92, 34, 'AUTO', () => {
        this.setStatus('Autoplay UI is visual-only in this POC');
      });
      this.mkButton(1080, barY + 42, 92, 34, 'SOUND', () => {
        this.soundOn = !this.soundOn;
        this.setStatus(this.soundOn ? 'Sound on' : 'Sound off');
      });
    }
  }

  private buildTestPanel(): void {
    const P = this.isPortrait;
    if (P) {
      // portrait: lay the vectors out in the gap between grid and bottom bar
      const y0 = 712;
      this.add.text(this.DW / 2, y0 - 22, 'DEV TEST VECTORS', {
        fontFamily: 'Trebuchet MS', fontSize: '12px', color: '#ff9f6e', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.vectors.forEach((v, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        this.mkButton(this.DW / 2 + (col - 1) * 148, y0 + 14 + row * 34, 140, 28, v, () => {
          this.pendingVector = v;
          this.setStatus(`Next spin forced: ${v}`);
        });
      });
      return;
    }
    const y0 = 220;
    this.add.text(28, y0 - 32, 'DEV TEST VECTORS', {
      fontFamily: 'Trebuchet MS', fontSize: '14px', color: '#ff9f6e', fontStyle: 'bold',
    });
    this.vectors.forEach((v, i) => {
      this.mkButton(96, y0 + i * 42, 150, 34, v, () => {
        this.pendingVector = v;
        this.setStatus(`Next spin forced: ${v}`);
      });
    });
  }

  /* ------------------------------------------------------------- helpers */

  private randomLookingBoard(): Board {
    const pool: SymbolId[] = ['PYRITE', 'QUARTZ', 'AMETHYST', 'EMERALD', 'RING', 'CHALICE', 'HELM', 'LYRE', 'CROWN'];
    const b: Board = [];
    for (let r = 0; r < REELS; r++) {
      const col: SymbolId[] = [];
      for (let q = 0; q < ROWS; q++) col.push(pool[Math.floor(Math.random() * pool.length)]);
      b.push(col);
    }
    return b;
  }

  private fillBoard(board: Board, orbs: Array<{ position: number; value: number }> = []): void {
    const visualTexture: Record<SymbolId, string> = {
      PYRITE: 'gates-low-1',
      QUARTZ: 'gates-low-2',
      AMETHYST: 'gates-low-3',
      EMERALD: 'gates-low-4',
      RING: 'gates-low-5',
      CHALICE: 'gates-high-1',
      HELM: 'gates-high-2',
      LYRE: 'gates-high-3',
      CROWN: 'gates-high-4',
      IDOL: 'gates-scatter',
      ORB: 'gates-bonus',
    };
    const orbMap = new Map(orbs.map((o) => [o.position, o.value]));
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const c = this.cells[reel][row];
        const sym = board[reel][row];
        c.sym.setTexture(visualTexture[sym]);
        // setTexture resets display size to the texture's native size - re-apply
        c.sym.setDisplaySize(this.cellSize * 0.99, this.cellSize * 0.99);
        c.sym.setAlpha(1);
        c.container.setAlpha(1);
        c.container.y = this.cellY(row);
        c.glow.setAlpha(0);
        const p = reel * ROWS + row;
        if (sym === 'ORB' && orbMap.has(p)) {
          c.label.setText(`x${orbMap.get(p)}`).setAlpha(1);
        } else {
          c.label.setAlpha(0);
        }
      }
    }
  }

  private cellY(row: number): number {
    return this.gridY + row * (this.cellSize + this.gap) + this.cellSize / 2;
  }

  private refreshHud(): void {
    this.txtBalance.setText(this.balance.toLocaleString('en-US'));
    this.txtStake.setText(String(this.stake));
    const buyCost = this.stake * this.buyMultiplier;
    const lbl = (this.btnBuy as any).labelText as Phaser.GameObjects.Text;
    lbl.setText(`BUY  ${buyCost.toLocaleString('en-US')}`);
  }

  private get stake(): number { return this.stakeLevels[this.stakeIndex] ?? 20; }

  private changeStake(dir: number): void {
    if (this.busy) return;
    const next = this.stakeIndex + dir;
    if (next < 0 || next >= this.stakeLevels.length) return;
    this.stakeIndex = next;
    this.refreshHud();
    this.blip(660, 0.05);
  }

  private setStatus(s: string): void { this.txtStatus?.setText(s); }

  private setWin(v: number, label = 'WIN'): void {
    this.txtWin.setText(`${label}  ${Math.round(v).toLocaleString('en-US')}`);
  }

  /** Tiny WebAudio blip - no audio files, no third-party assets. */
  private blip(freq: number, gain = 0.06, dur = 0.08): void {
    if (!this.soundOn) return;
    try {
      this.audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audio;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch { /* audio is optional */ }
  }

  private playSfx(key: string): void {
    if (!this.soundOn || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume: 0.42 });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => this.time.delayedCall(ms, r));
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    const alpha = b ? 0.45 : 1;
    this.btnSpin.setAlpha(alpha);
    this.btnBuy.setAlpha(alpha);
    this.spinLabel.setText(b ? '...' : 'SPIN');
  }

  /* ---------------------------------------------------------------- play */

  private async doSpin(buy: boolean): Promise<void> {
    if (this.busy) return;
    const cost = buy ? this.stake * this.buyMultiplier : this.stake;
    if (this.balance < cost) {
      this.setStatus('Insufficient balance');
      this.blip(180, 0.08, 0.2);
      return;
    }

    this.setBusy(true);
    this.setWin(0);
    this.multPanel.setAlpha(0);
    this.fsPanel.setAlpha(0);
    this.setStatus(buy ? 'Buying bonus...' : 'Spinning...');
    this.playSfx('gates-spin');

    const roundId = newRoundId();
    // survive a refresh mid-round: remember the in-flight round
    sessionStorage.setItem('fg:pendingRound', roundId);

    let round: RoundResponse;
    try {
      round = await api.spin({
        stake: this.stake, roundId, buyBonus: buy, testVector: this.pendingVector,
      });
      this.pendingVector = undefined;
    } catch (e: any) {
      this.setBusy(false);
      this.setStatus(e?.message === 'INSUFFICIENT_FUNDS' ? 'Insufficient balance' : 'Unable to complete spin');
      sessionStorage.removeItem('fg:pendingRound');
      return;
    }

    await this.playRound(round);
    sessionStorage.removeItem('fg:pendingRound');
    this.setBusy(false);
  }

  /** Animate a complete server response. The client invents nothing. */
  private async playRound(round: RoundResponse): Promise<void> {
    let running = 0;

    for (const spin of round.spins) {
      if (spin.kind === 'FREE') {
        this.fsPanel.setAlpha(1);
        this.txtFsCount.setText(`${spin.freeSpinNumber} / ${spin.freeSpinsTotal}`);
      }
      running = await this.playSpin(spin, running, round);
    }

    // settle
    this.balance = round.balanceAfter;
    this.refreshHud();
    this.setWin(round.finalWin, round.finalWin > 0 ? 'TOTAL WIN' : 'WIN');
    if (round.finalWin > 0) {
      this.bigWinFlash(round.finalWin, round.stake);
      this.setStatus(`Win ${round.finalWin.toLocaleString('en-US')}`);
    } else {
      this.setStatus('No win - press SPIN');
    }
  }

  private async playSpin(spin: SpinResult, runningTotal: number, round: RoundResponse): Promise<number> {
    this.fillBoard(spin.initialBoard, spin.steps[0]?.multiplierData ?? []);
    await this.dropIn();

    if (spin.freeSpinsAwarded > 0 && spin.kind !== 'FREE') {
      await this.animateScatterTrigger(spin.initialBoard);
      await this.featureBanner('FREE SPINS', `${spin.freeSpinsAwarded} SPINS`);
    }

    // free-spin intro
    if (spin.kind === 'FREE' && spin.freeSpinNumber === 1) {
      await this.featureBanner('FREE SPINS', `${spin.freeSpinsTotal} SPINS`);
    }
    if (spin.freeSpinsAwarded > 0 && spin.kind === 'FREE') {
      await this.animateScatterTrigger(spin.initialBoard);
      await this.featureBanner('RETRIGGER', `+${spin.freeSpinsAwarded} SPINS`);
    }

    let running = runningTotal;

    for (const step of spin.steps) {
      if (step.multiplierData.length > 0) {
        this.multPanel.setAlpha(1);
        this.txtMultiplier.setText(`x${round.freeSpins.accumulated || spin.appliedMultiplier}`);
        await this.animateOrbs(step.multiplierData);
      }
      if (step.winningPositions.length === 0) break;

      // highlight winners
      for (const p of step.winningPositions) {
        const c = this.cells[Math.floor(p / ROWS)][p % ROWS];
        c.glow.setAlpha(0);
        this.tweens.add({ targets: c.glow, alpha: 1, duration: 140 });
        this.tweens.add({ targets: c.sym, scale: 1.12, duration: 160, yoyo: true });
      }
      this.blip(880 + Math.min(step.index, 6) * 90, 0.05);
      this.playSfx('gates-win');
      running += step.win;
      this.setWin(running);
      await this.wait(420);

      // pop winners
      const pops: Promise<void>[] = [];
      for (const p of step.winningPositions) {
        const c = this.cells[Math.floor(p / ROWS)][p % ROWS];
        this.sparkle(c.container.x, c.container.y);
        pops.push(new Promise<void>((res) => {
          this.tweens.add({
            targets: [c.sym, c.glow], alpha: 0, scale: 0.4,
            duration: 200, ease: 'Back.in', onComplete: () => res(),
          });
        }));
      }
      await Promise.all(pops);

      if (step.boardAfter) {
        this.fillBoard(step.boardAfter, step.multiplierData);
        await this.dropIn(true);
      }
    }

    // apply the spin multiplier
    if (spin.appliedMultiplier > 1 && spin.baseWin > 0) {
      this.multPanel.setAlpha(1);
      this.txtMultiplier.setText(`x${spin.appliedMultiplier}`);
      this.tweens.add({
        targets: this.multPanel, scale: { from: 1, to: 1.25 },
        duration: 260, yoyo: true, ease: 'Back.out',
      });
      this.blip(1200, 0.08, 0.22);
      this.playSfx('gates-multiplier');
      await this.wait(420);
      running = runningTotal + spin.spinWin;
      this.setWin(running);
    } else {
      running = runningTotal + spin.spinWin;
      this.setWin(running);
    }

    if (spin.scatterPay > 0) await this.wait(200);
    await this.wait(spin.kind === 'FREE' ? 240 : 320);
    return running;
  }

  private dropIn(fast = false): Promise<void> {
    return new Promise((resolve) => {
      const dur = fast ? 240 : 320;
      let done = 0; const total = REELS * ROWS;
      for (let reel = 0; reel < REELS; reel++) {
        for (let row = 0; row < ROWS; row++) {
          const c = this.cells[reel][row];
          const targetY = this.cellY(row);
          c.container.y = targetY - (this.cellSize + this.gap) * (ROWS + 1);
          this.tweens.add({
            targets: c.container, y: targetY, duration: dur,
            delay: reel * 42 + row * 14, ease: 'Cubic.out',
            onComplete: () => { done++; if (done === total) resolve(); },
          });
        }
      }
    });
  }

  private sparkle(x: number, y: number): void {
    const p = this.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 210 }, lifespan: 480, quantity: 8,
      scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 },
      blendMode: 'ADD', emitting: false,
    });
    p.explode(10);
    this.time.delayedCall(600, () => p.destroy());
  }

  private async featureBanner(title: string, sub: string): Promise<void> {
    const overlay = this.add.rectangle(this.DW / 2, this.DH / 2, this.DW, this.DH, 0x0a0713, 0.82)
      .setDepth(50);
    const t = this.add.text(this.DW / 2, this.DH / 2 - 30, title, {
      fontFamily: 'Georgia', fontSize: '84px', color: '#f5c451', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(51).setAlpha(0);
    const s = this.add.text(this.DW / 2, this.DH / 2 + 52, sub, {
      fontFamily: 'Trebuchet MS', fontSize: '38px', color: '#e8e3f2',
    }).setOrigin(0.5).setDepth(51).setAlpha(0);
    t.setShadow(0, 6, '#1a0b33', 16, true, true);

    this.blip(520, 0.08, 0.3);
    this.playSfx('gates-feature');
    this.tweens.add({ targets: [t, s], alpha: 1, duration: 260 });
    this.tweens.add({ targets: t, scale: { from: 0.7, to: 1 }, duration: 380, ease: 'Back.out' });
    await this.wait(1150);
    await new Promise<void>((res) => {
      this.tweens.add({
        targets: [overlay, t, s], alpha: 0, duration: 300,
        onComplete: () => { overlay.destroy(); t.destroy(); s.destroy(); res(); },
      });
    });
  }

  private async animateScatterTrigger(board: Board): Promise<void> {
    const scatters: Cell[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        if (board[reel][row] === 'IDOL') scatters.push(this.cells[reel][row]);
      }
    }
    this.playSfx('gates-feature');
    for (const cell of scatters) {
      this.tweens.add({ targets: cell.glow, alpha: 1, duration: 180, yoyo: true, repeat: 2 });
      this.tweens.add({ targets: cell.sym, scale: 1.2, duration: 220, yoyo: true, ease: 'Sine.inOut' });
    }
    await this.wait(850);
  }

  private async animateOrbs(orbs: Array<{ position: number; value: number }>): Promise<void> {
    for (const orb of orbs) {
      const cell = this.cells[Math.floor(orb.position / ROWS)][orb.position % ROWS];
      this.playSfx('gates-multiplier');
      this.cameras.main.flash(120, 150, 210, 255);
      this.cameras.main.shake(160, 0.004);
      this.tweens.add({ targets: cell.sym, scale: 1.26, duration: 240, yoyo: true, ease: 'Back.out' });
      cell.label.setText(`x${orb.value}`).setAlpha(1).setScale(0.7);
      this.tweens.add({ targets: cell.label, scale: 1.15, duration: 260, yoyo: true });
      await this.wait(420);
      this.sparkle(cell.container.x, cell.container.y);
      this.tweens.add({ targets: [cell.sym, cell.label], alpha: 0.2, scale: 1.5, duration: 260, yoyo: true });
      await this.wait(260);
    }
  }

  private bigWinFlash(win: number, stake: number): void {
    const ratio = win / Math.max(stake, 1);
    if (ratio < 10) { this.blip(760, 0.06, 0.16); return; }
    if (this.zeusImage) {
      this.tweens.add({
        targets: this.zeusImage,
        scale: { from: 1, to: 1.08 },
        angle: { from: 0, to: -2 },
        duration: 180,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.inOut',
      });
    }
    const label = ratio >= 100 ? 'MEGA WIN' : ratio >= 40 ? 'HUGE WIN' : 'BIG WIN';
    const t = this.add.text(this.DW / 2, this.DH / 2, label, {
      fontFamily: 'Georgia', fontSize: '76px', color: '#ffd98a', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(60).setAlpha(0);
    t.setShadow(0, 6, '#1a0b33', 16, true, true);
    this.tweens.add({ targets: t, alpha: 1, scale: { from: 0.6, to: 1.08 }, duration: 380, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 420, onComplete: () => t.destroy() });
    this.blip(980, 0.09, 0.3);
    this.time.delayedCall(140, () => this.blip(1240, 0.08, 0.3));
  }
}
