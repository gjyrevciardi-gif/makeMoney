import type { EffectMetadata, SlotEffect } from "./types.js";

// <effect-imports>
import smokePuff from "./effects/smoke/smoke-puff.js";
import smokeTrail from "./effects/smoke/smoke-trail.js";
import smokeRing from "./effects/smoke/smoke-ring.js";
import smokeBurst from "./effects/smoke/smoke-burst.js";
import smokeColumn from "./effects/smoke/smoke-column.js";
import smokeFloorFog from "./effects/smoke/smoke-floor-fog.js";
import smokeDrift from "./effects/smoke/smoke-drift.js";
import smokeVortex from "./effects/smoke/smoke-vortex.js";
import smokeImpact from "./effects/smoke/smoke-impact.js";
import smokeReveal from "./effects/smoke/smoke-reveal.js";
import fireFlame from "./effects/fire/fire-flame.js";
import fireBurst from "./effects/fire/fire-burst.js";
import fireTrail from "./effects/fire/fire-trail.js";
import fireRing from "./effects/fire/fire-ring.js";
import fireEmbers from "./effects/fire/fire-embers.js";
import fireWall from "./effects/fire/fire-wall.js";
import fireAura from "./effects/fire/fire-aura.js";
import fireImpact from "./effects/fire/fire-impact.js";
import fireWipe from "./effects/fire/fire-wipe.js";
import fireInferno from "./effects/fire/fire-inferno.js";
import lightPointGlow from "./effects/lights/light-point-glow.js";
import lightRadialPulse from "./effects/lights/light-radial-pulse.js";
import lightSpotlight from "./effects/lights/light-spotlight.js";
import lightSweep from "./effects/lights/light-sweep.js";
import lightBeam from "./effects/lights/light-beam.js";
import lightRays from "./effects/lights/light-rays.js";
import lightNeonFlicker from "./effects/lights/light-neon-flicker.js";
import lightStrobe from "./effects/lights/light-strobe.js";
import lightColorWash from "./effects/lights/light-color-wash.js";
import lightVignettePulse from "./effects/lights/light-vignette-pulse.js";
import lightBacklight from "./effects/lights/light-backlight.js";
import lightMarquee from "./effects/lights/light-marquee.js";
import shineGlint from "./effects/shines/shine-glint.js";
import shineSparkle from "./effects/shines/shine-sparkle.js";
import shineStarburst from "./effects/shines/shine-starburst.js";
import shineSweep from "./effects/shines/shine-sweep.js";
import shineEdge from "./effects/shines/shine-edge.js";
import shineHalo from "./effects/shines/shine-halo.js";
import shineTwinkle from "./effects/shines/shine-twinkle.js";
import shineGem from "./effects/shines/shine-gem.js";
import shineMetal from "./effects/shines/shine-metal.js";
import shineRainbow from "./effects/shines/shine-rainbow.js";
import laserLine from "./effects/lasers/laser-line.js";
import laserBeam from "./effects/lasers/laser-beam.js";
import laserScan from "./effects/lasers/laser-scan.js";
import laserGrid from "./effects/lasers/laser-grid.js";
import laserCrosshair from "./effects/lasers/laser-crosshair.js";
import laserBurst from "./effects/lasers/laser-burst.js";
import laserFan from "./effects/lasers/laser-fan.js";
import laserRing from "./effects/lasers/laser-ring.js";
import laserBounce from "./effects/lasers/laser-bounce.js";
import laserTarget from "./effects/lasers/laser-target.js";
import laserChase from "./effects/lasers/laser-chase.js";
import laserVortex from "./effects/lasers/laser-vortex.js";
import symbolWinPulse from "./effects/symbols/symbol-win-pulse.js";
import symbolPop from "./effects/symbols/symbol-pop.js";
import symbolBounce from "./effects/symbols/symbol-bounce.js";
import symbolShake from "./effects/symbols/symbol-shake.js";
import symbolSpin from "./effects/symbols/symbol-spin.js";
import symbolFlip from "./effects/symbols/symbol-flip.js";
import symbolGlow from "./effects/symbols/symbol-glow.js";
import symbolOutline from "./effects/symbols/symbol-outline.js";
import symbolExplode from "./effects/symbols/symbol-explode.js";
import symbolParticleBurst from "./effects/symbols/symbol-particle-burst.js";
import symbolFreeze from "./effects/symbols/symbol-freeze.js";
import symbolElectrify from "./effects/symbols/symbol-electrify.js";
import symbolTransform from "./effects/symbols/symbol-transform.js";
import symbolWildReveal from "./effects/symbols/symbol-wild-reveal.js";
import reelSpinBlur from "./effects/reels/reel-spin-blur.js";
import reelSpeedLines from "./effects/reels/reel-speed-lines.js";
import reelStopImpact from "./effects/reels/reel-stop-impact.js";
import reelAnticipation from "./effects/reels/reel-anticipation.js";
import reelNudge from "./effects/reels/reel-nudge.js";
import reelBounce from "./effects/reels/reel-bounce.js";
import reelShake from "./effects/reels/reel-shake.js";
import reelGlow from "./effects/reels/reel-glow.js";
import reelWinFrame from "./effects/reels/reel-win-frame.js";
import reelCascade from "./effects/reels/reel-cascade.js";
import reelWipe from "./effects/reels/reel-wipe.js";
import reelLock from "./effects/reels/reel-lock.js";
import buttonHoverGlow from "./effects/buttons/button-hover-glow.js";
import buttonPress from "./effects/buttons/button-press.js";
import buttonRipple from "./effects/buttons/button-ripple.js";
import buttonPulse from "./effects/buttons/button-pulse.js";
import buttonShine from "./effects/buttons/button-shine.js";
import buttonSpark from "./effects/buttons/button-spark.js";
import buttonCharge from "./effects/buttons/button-charge.js";
import buttonDisabled from "./effects/buttons/button-disabled.js";
import buttonWin from "./effects/buttons/button-win.js";
import buttonAttention from "./effects/buttons/button-attention.js";
import backgroundParticles from "./effects/backgrounds/background-particles.js";
import backgroundParallax from "./effects/backgrounds/background-parallax.js";
import backgroundAurora from "./effects/backgrounds/background-aurora.js";
import backgroundStars from "./effects/backgrounds/background-stars.js";
import backgroundBokeh from "./effects/backgrounds/background-bokeh.js";
import backgroundLightning from "./effects/backgrounds/background-lightning.js";
import backgroundConfetti from "./effects/backgrounds/background-confetti.js";
import backgroundRadialPulse from "./effects/backgrounds/background-radial-pulse.js";
import backgroundColorCycle from "./effects/backgrounds/background-color-cycle.js";
import backgroundVignette from "./effects/backgrounds/background-vignette.js";
// </effect-imports>

export const effectIds = [
// <effect-ids>
  "smoke-puff",
  "smoke-trail",
  "smoke-ring",
  "smoke-burst",
  "smoke-column",
  "smoke-floor-fog",
  "smoke-drift",
  "smoke-vortex",
  "smoke-impact",
  "smoke-reveal",
  "fire-flame",
  "fire-burst",
  "fire-trail",
  "fire-ring",
  "fire-embers",
  "fire-wall",
  "fire-aura",
  "fire-impact",
  "fire-wipe",
  "fire-inferno",
  "light-point-glow",
  "light-radial-pulse",
  "light-spotlight",
  "light-sweep",
  "light-beam",
  "light-rays",
  "light-neon-flicker",
  "light-strobe",
  "light-color-wash",
  "light-vignette-pulse",
  "light-backlight",
  "light-marquee",
  "shine-glint",
  "shine-sparkle",
  "shine-starburst",
  "shine-sweep",
  "shine-edge",
  "shine-halo",
  "shine-twinkle",
  "shine-gem",
  "shine-metal",
  "shine-rainbow",
  "laser-line",
  "laser-beam",
  "laser-scan",
  "laser-grid",
  "laser-crosshair",
  "laser-burst",
  "laser-fan",
  "laser-ring",
  "laser-bounce",
  "laser-target",
  "laser-chase",
  "laser-vortex",
  "symbol-win-pulse",
  "symbol-pop",
  "symbol-bounce",
  "symbol-shake",
  "symbol-spin",
  "symbol-flip",
  "symbol-glow",
  "symbol-outline",
  "symbol-explode",
  "symbol-particle-burst",
  "symbol-freeze",
  "symbol-electrify",
  "symbol-transform",
  "symbol-wild-reveal",
  "reel-spin-blur",
  "reel-speed-lines",
  "reel-stop-impact",
  "reel-anticipation",
  "reel-nudge",
  "reel-bounce",
  "reel-shake",
  "reel-glow",
  "reel-win-frame",
  "reel-cascade",
  "reel-wipe",
  "reel-lock",
  "button-hover-glow",
  "button-press",
  "button-ripple",
  "button-pulse",
  "button-shine",
  "button-spark",
  "button-charge",
  "button-disabled",
  "button-win",
  "button-attention",
  "background-particles",
  "background-parallax",
  "background-aurora",
  "background-stars",
  "background-bokeh",
  "background-lightning",
  "background-confetti",
  "background-radial-pulse",
  "background-color-cycle",
  "background-vignette",
// </effect-ids>
] as const;

export type EffectId = (typeof effectIds)[number];

const definitions: readonly SlotEffect[] = [
// <effect-definitions>
  smokePuff,
  smokeTrail,
  smokeRing,
  smokeBurst,
  smokeColumn,
  smokeFloorFog,
  smokeDrift,
  smokeVortex,
  smokeImpact,
  smokeReveal,
  fireFlame,
  fireBurst,
  fireTrail,
  fireRing,
  fireEmbers,
  fireWall,
  fireAura,
  fireImpact,
  fireWipe,
  fireInferno,
  lightPointGlow,
  lightRadialPulse,
  lightSpotlight,
  lightSweep,
  lightBeam,
  lightRays,
  lightNeonFlicker,
  lightStrobe,
  lightColorWash,
  lightVignettePulse,
  lightBacklight,
  lightMarquee,
  shineGlint,
  shineSparkle,
  shineStarburst,
  shineSweep,
  shineEdge,
  shineHalo,
  shineTwinkle,
  shineGem,
  shineMetal,
  shineRainbow,
  laserLine,
  laserBeam,
  laserScan,
  laserGrid,
  laserCrosshair,
  laserBurst,
  laserFan,
  laserRing,
  laserBounce,
  laserTarget,
  laserChase,
  laserVortex,
  symbolWinPulse,
  symbolPop,
  symbolBounce,
  symbolShake,
  symbolSpin,
  symbolFlip,
  symbolGlow,
  symbolOutline,
  symbolExplode,
  symbolParticleBurst,
  symbolFreeze,
  symbolElectrify,
  symbolTransform,
  symbolWildReveal,
  reelSpinBlur,
  reelSpeedLines,
  reelStopImpact,
  reelAnticipation,
  reelNudge,
  reelBounce,
  reelShake,
  reelGlow,
  reelWinFrame,
  reelCascade,
  reelWipe,
  reelLock,
  buttonHoverGlow,
  buttonPress,
  buttonRipple,
  buttonPulse,
  buttonShine,
  buttonSpark,
  buttonCharge,
  buttonDisabled,
  buttonWin,
  buttonAttention,
  backgroundParticles,
  backgroundParallax,
  backgroundAurora,
  backgroundStars,
  backgroundBokeh,
  backgroundLightning,
  backgroundConfetti,
  backgroundRadialPulse,
  backgroundColorCycle,
  backgroundVignette,
// </effect-definitions>
];

export const effectRegistry = createRegistry(definitions);

export const effectCatalog: readonly EffectMetadata[] = Object.freeze(
  definitions.map((definition) => definition.metadata),
);

function createRegistry(items: readonly SlotEffect[]): Readonly<Record<EffectId, SlotEffect>> {
  const entries = new Map<string, SlotEffect>();
  for (const definition of items) {
    const id = definition.metadata.id;
    if (entries.has(id)) throw new Error(`Duplicate slot effect registration: ${id}`);
    entries.set(id, definition);
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<EffectId, SlotEffect>>;
}
