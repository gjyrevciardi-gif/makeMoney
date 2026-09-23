import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

/**
 * Two design targets, chosen from the real viewport at boot:
 *   landscape/desktop  1440 x 900
 *   portrait/mobile     480 x 1040   (covers 430px phones with margin)
 * Phaser then FITs the chosen design box into whatever the window actually is,
 * so both targets stay pixel-crisp and correctly proportioned.
 */
const portrait = window.innerHeight > window.innerWidth;
const DESIGN_W = portrait ? 480 : 1440;
const DESIGN_H = portrait ? 1040 : 900;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0713',
  width: DESIGN_W,
  height: DESIGN_H,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_W,
    height: DESIGN_H,
  },
  render: { antialias: true, roundPixels: false },
  scene: [GameScene],
});

// a rotation that changes orientation class needs the new design box
let wasPortrait = portrait;
window.addEventListener('resize', () => {
  const nowPortrait = window.innerHeight > window.innerWidth;
  if (nowPortrait !== wasPortrait) { wasPortrait = nowPortrait; location.reload(); }
});
