import type { GameConfig } from "@slot-skills/schema";

export interface PlayerPolicyContext {
  ageBand: "18-24" | "25+";
  jurisdiction: string;
}

export interface JurisdictionProfile {
  id: string;
  displayName: string;
  reviewedAt: string;
  reviewBy: string;
  sourceUrls: string[];
  minimumCycleMs: number;
  maxStakeUnits(context: PlayerPolicyContext): bigint;
  blockedFeatures: readonly string[];
  validate(game: GameConfig): string[];
}

const GB_SOURCES = [
  "https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-7-generation-of-random-outcomes",
  "https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-14-responsible-product-design",
  "https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/online-slots-stake-limit-guidance",
  "https://gaminglabs.com/wp-content/uploads/2024/06/GLI-19-Interactive-Gaming-Systems-v3.0.pdf",
] as const;

export const gbGliReferenceProfile: JurisdictionProfile = {
  id: "gb-gli-reference",
  displayName: "Great Britain with GLI-19 reference controls",
  reviewedAt: "2026-07-18",
  reviewBy: "2026-10-18",
  sourceUrls: [...GB_SOURCES],
  minimumCycleMs: 2500,
  maxStakeUnits: (context) => context.ageBand === "18-24" ? 200n : 500n,
  blockedFeatures: ["bonus-buy", "ante-bet", "gamble-feature", "double-or-nothing", "near-miss-enhancement", "must-win-by-jackpot"],
  validate(game) {
    const errors: string[] = [];
    if (game.presentation.cycleDurationMs < 2500) errors.push("GB profile requires a minimum 2500ms game cycle");
    if (game.presentation.autoPlay) errors.push("GB profile prohibits autoplay");
    if (game.presentation.turbo) errors.push("GB profile prohibits turbo play");
    if (game.presentation.slamStop) errors.push("GB profile prohibits slam stop");
    if (game.presentation.celebrateReturnAtOrBelowStake) errors.push("GB profile prohibits celebrating returns at or below stake");
    for (const feature of game.features.filter((selection) => selection.enabled)) {
      if (this.blockedFeatures.includes(feature.id)) errors.push(`GB reference profile blocks ${feature.id} pending operator and lab approval`);
    }
    return errors;
  },
};

const MT_SOURCES = [
  "https://legislation.mt/eli/cap/583/eng",
  "https://www.mga.org.mt/app/uploads/Gaming-Authorisations-and-Compliance-Directive-Directive-3-of-2018.pdf",
  "https://www.mga.org.mt/app/uploads/Player-Protection-Directive-Directive-2-of-2018.pdf",
  "https://gaminglabs.com/wp-content/uploads/2024/06/GLI-19-Interactive-Gaming-Systems-v3.0.pdf",
] as const;

export const mtMgaReferenceProfile: JurisdictionProfile = {
  id: "mt-mga-reference",
  displayName: "Malta MGA with GLI-19 reference controls",
  reviewedAt: "2026-07-20",
  reviewBy: "2026-10-18",
  sourceUrls: [...MT_SOURCES],
  minimumCycleMs: 1000,
  maxStakeUnits: (context) => context.ageBand === "18-24" ? 20000n : 100000n,
  blockedFeatures: [],
  validate(game) {
    const errors: string[] = [];
    if (game.presentation.cycleDurationMs < 1000) errors.push("MT profile requires a minimum 1000ms game cycle");
    if (!game.presentation.reducedMotionFallback) errors.push("MT profile requires a reduced-motion fallback");
    return errors;
  },
};

export const jurisdictionProfiles = Object.freeze({ [gbGliReferenceProfile.id]: gbGliReferenceProfile, [mtMgaReferenceProfile.id]: mtMgaReferenceProfile });

export function validateJurisdiction(game: GameConfig, release = false, now = new Date()): void {
  const profile = jurisdictionProfiles[game.jurisdiction.profileId as keyof typeof jurisdictionProfiles];
  if (!profile) throw new Error(`Unknown jurisdiction profile: ${game.jurisdiction.profileId}`);
  const errors = profile.validate(game);
  if (release && new Date(`${profile.reviewBy}T23:59:59Z`) < now) errors.push(`Compliance profile review expired on ${profile.reviewBy}`);
  if (errors.length) throw new Error(errors.join("; "));
}
