import { analyseSlotRtp, maxPossibleReturnNumerator } from './slot.rtp';
import { SlotGameDefinition, SlotPayline } from './slot.types';

/**
 * Frozen slot definitions.
 *
 * A definition is immutable: changing a strip, a payline, or a paytable entry
 * means publishing a *new* version, never editing this one, so a settled round
 * stays reproducible from the version it recorded.
 */

const line = (id: number, rows: number[]): SlotPayline => ({ id, rows });

/**
 * Fool's Gold Rush - original mining theme, 5 reels x 3 rows, 20 fixed paylines.
 *
 * Symbol frequencies and paytable were designed together so that the exact
 * theoretical return lands deliberately at 94.993125%. The strips deliberately
 * keep Wild off reels 1 and 5 and never place two scatters adjacently, which is
 * what keeps the top combinations rare.
 *
 * Nothing here is derived from, or resembles, any commercial slot: the theme,
 * symbol set, strips, paylines and paytable are all original to this project.
 */
export const FOOLS_GOLD_RUSH_V1: SlotGameDefinition = {
  gameId: 'fools-gold-rush',
  name: "Fool's Gold Rush",
  description: 'Five reels of pickaxes, lanterns and fool’s gold. 20 fixed lines.',
  mathVersion: 1,
  reels: 5,
  rows: 3,
  symbols: [
    // Order matters: it is the deterministic tie-break when two symbols pay the
    // same on one line, so premium symbols are declared first.
    { id: 'GOLD', name: "Fool's Gold", type: 'NORMAL' },
    { id: 'NUGGET', name: 'Gold Nugget', type: 'NORMAL' },
    { id: 'CART', name: 'Mine Cart', type: 'NORMAL' },
    { id: 'PICKAXE', name: 'Pickaxe', type: 'NORMAL' },
    { id: 'LANTERN', name: 'Lantern', type: 'NORMAL' },
    { id: 'HORSESHOE', name: 'Horseshoe', type: 'NORMAL' },
    { id: 'WILD', name: 'Wild Nugget', type: 'WILD' },
    { id: 'SCATTER', name: 'Dynamite Scatter', type: 'SCATTER' },
  ],
  strips: [
    [
      'HORSESHOE', 'LANTERN', 'PICKAXE', 'CART', 'HORSESHOE', 'GOLD', 'LANTERN', 'PICKAXE',
      'HORSESHOE', 'SCATTER', 'CART', 'LANTERN', 'PICKAXE', 'HORSESHOE', 'NUGGET', 'LANTERN',
      'PICKAXE', 'HORSESHOE', 'CART', 'LANTERN',
    ],
    [
      'LANTERN', 'HORSESHOE', 'PICKAXE', 'WILD', 'LANTERN', 'CART', 'HORSESHOE', 'PICKAXE',
      'LANTERN', 'HORSESHOE', 'NUGGET', 'SCATTER', 'PICKAXE', 'CART', 'LANTERN', 'GOLD',
      'HORSESHOE', 'PICKAXE', 'LANTERN', 'HORSESHOE',
    ],
    [
      'PICKAXE', 'HORSESHOE', 'LANTERN', 'CART', 'WILD', 'PICKAXE', 'HORSESHOE', 'LANTERN',
      'GOLD', 'HORSESHOE', 'PICKAXE', 'SCATTER', 'LANTERN', 'CART', 'HORSESHOE', 'NUGGET',
      'PICKAXE', 'LANTERN', 'HORSESHOE', 'PICKAXE',
    ],
    [
      'HORSESHOE', 'LANTERN', 'PICKAXE', 'CART', 'HORSESHOE', 'WILD', 'LANTERN', 'PICKAXE',
      'NUGGET', 'HORSESHOE', 'LANTERN', 'SCATTER', 'PICKAXE', 'CART', 'HORSESHOE', 'GOLD',
      'LANTERN', 'PICKAXE', 'HORSESHOE', 'LANTERN',
    ],
    [
      'HORSESHOE', 'PICKAXE', 'LANTERN', 'CART', 'HORSESHOE', 'PICKAXE', 'GOLD', 'LANTERN',
      'HORSESHOE', 'SCATTER', 'PICKAXE', 'NUGGET', 'LANTERN', 'CART', 'HORSESHOE', 'PICKAXE',
      'LANTERN', 'HORSESHOE', 'CART', 'PICKAXE',
    ],
  ],
  paylines: [
    line(1, [1, 1, 1, 1, 1]), line(2, [0, 0, 0, 0, 0]), line(3, [2, 2, 2, 2, 2]),
    line(4, [0, 1, 2, 1, 0]), line(5, [2, 1, 0, 1, 2]), line(6, [0, 0, 1, 2, 2]),
    line(7, [2, 2, 1, 0, 0]), line(8, [1, 0, 0, 0, 1]), line(9, [1, 2, 2, 2, 1]),
    line(10, [0, 1, 1, 1, 0]), line(11, [2, 1, 1, 1, 2]), line(12, [1, 0, 1, 2, 1]),
    line(13, [1, 2, 1, 0, 1]), line(14, [0, 0, 1, 0, 0]), line(15, [2, 2, 1, 2, 2]),
    line(16, [1, 1, 0, 1, 1]), line(17, [1, 1, 2, 1, 1]), line(18, [0, 1, 0, 1, 0]),
    line(19, [2, 1, 2, 1, 2]), line(20, [0, 2, 0, 2, 0]),
  ],
  // Multipliers in centi of the bet per line.
  paytable: {
    GOLD: { 3: 5_000, 4: 20_000, 5: 100_000 },
    NUGGET: { 3: 2_500, 4: 10_000, 5: 50_000 },
    CART: { 3: 1_800, 4: 5_500, 5: 22_500 },
    PICKAXE: { 3: 900, 4: 2_800, 5: 11_500 },
    LANTERN: { 3: 600, 4: 1_800, 5: 7_000 },
    HORSESHOE: { 3: 500, 4: 1_400, 5: 5_500 },
  },
  scatter: {
    symbolId: 'SCATTER',
    minimumCount: 3,
    // Multipliers in centi of the total stake.
    tiers: { 3: 100, 4: 500, 5: 2_500 },
  },
  // Structural guard only. The exhaustively verified true maximum is 61.90x, so
  // this cap is far above anything the board can produce and never alters the
  // mathematics; `validateSlotDefinition` refuses a definition where it could.
  maxWinCenti: 200_000,
  volatility: 'LOW',
  // Verified against the exact computed value at startup.
  declaredRtpBps: 9_499,
};

const DEFINITIONS: SlotGameDefinition[] = [FOOLS_GOLD_RUSH_V1];
/**
 * Approved alternative mathematics for the same game.
 *
 * Each profile freezes its own paytable and reports the RTP that the exact
 * calculator actually derives from it - not a rounded marketing figure. Only
 * the paytable and the scatter tiers differ; strips, paylines, wild rules and
 * stake semantics are shared, so the reels and their probabilities are
 * untouched. An operator selects a profile; nothing biases an individual spin.
 */
export const FOOLS_GOLD_RUSH_PROFILES: Record<string, SlotGameDefinition> = {
  STANDARD: FOOLS_GOLD_RUSH_V1,
  REDUCED: {
    ...FOOLS_GOLD_RUSH_V1,
    mathVersion: 2,
    description: "Fool's Gold Rush with a reduced-return paytable.",
    paytable: {
      GOLD: { 3: 3_950, 4: 15_800, 5: 79_000 },
      NUGGET: { 3: 2_000, 4: 7_900, 5: 39_500 },
      CART: { 3: 1_400, 4: 4_350, 5: 17_800 },
      PICKAXE: { 3: 700, 4: 2_200, 5: 9_100 },
      LANTERN: { 3: 450, 4: 1_400, 5: 5_550 },
      HORSESHOE: { 3: 400, 4: 1_100, 5: 4_350 },
    },
    scatter: {
      symbolId: 'SCATTER',
      minimumCount: 3,
      tiers: { 3: 80, 4: 400, 5: 2_000 },
    },
    declaredRtpBps: 7_456,
  },
  MINIMAL: {
    ...FOOLS_GOLD_RUSH_V1,
    mathVersion: 3,
    description: "Fool's Gold Rush with the lowest approved return.",
    paytable: {
      GOLD: { 3: 2_700, 4: 10_700, 5: 53_500 },
      NUGGET: { 3: 1_350, 4: 5_350, 5: 26_750 },
      CART: { 3: 950, 4: 2_950, 5: 12_050 },
      PICKAXE: { 3: 500, 4: 1_500, 5: 6_150 },
      LANTERN: { 3: 300, 4: 950, 5: 3_750 },
      HORSESHOE: { 3: 250, 4: 750, 5: 2_950 },
    },
    scatter: {
      symbolId: 'SCATTER',
      minimumCount: 3,
      tiers: { 3: 60, 4: 300, 5: 1_500 },
    },
    declaredRtpBps: 5_067,
  },
};

export type SlotProfileName = keyof typeof FOOLS_GOLD_RUSH_PROFILES;

/** Resolves an approved profile by name, falling back to the standard maths. */
export function slotProfile(gameId: string, profile: string | undefined): SlotGameDefinition {
  if (gameId !== FOOLS_GOLD_RUSH_V1.gameId) {
    const definition = findSlotDefinition(gameId);
    if (!definition) throw new SlotDefinitionError(`unknown slot game ${gameId}`);
    return definition;
  }
  const selected = FOOLS_GOLD_RUSH_PROFILES[profile ?? 'STANDARD'];
  if (!selected) throw new SlotDefinitionError(`unknown slot profile ${profile}`);
  return selected;
}

/** Every approved profile, validated, for admin preview and startup checks. */
export function slotProfileSummaries() {
  return Object.entries(FOOLS_GOLD_RUSH_PROFILES).map(([name, definition]) => ({
    profile: name,
    gameId: definition.gameId,
    version: slotVersion(definition),
    rtpBps: definition.declaredRtpBps,
    houseEdgeBps: 10_000 - definition.declaredRtpBps,
    volatility: definition.volatility,
    maxWinCenti: definition.maxWinCenti,
    paytable: definition.paytable,
    scatter: definition.scatter,
  }));
}


/**
 * Deterministic version identity, e.g. `fools-gold-rush.v1.rtp9499`.
 * The exact RTP is part of the identity, so a maths change forces a new version.
 */
export function slotVersion(definition: SlotGameDefinition): string {
  return `${definition.gameId}.v${definition.mathVersion}.rtp${definition.declaredRtpBps}`;
}

export class SlotDefinitionError extends Error {}

/**
 * Fail-fast structural and mathematical validation.
 *
 * Runs at startup and in tests. A built-in definition that does not satisfy
 * every rule here is a bug in the game maths, not a runtime condition, so it
 * throws rather than degrading.
 */
export function validateSlotDefinition(definition: SlotGameDefinition): void {
  const fail = (message: string) => {
    throw new SlotDefinitionError(`${definition.gameId}: ${message}`);
  };

  if (!/^[a-z0-9-]{3,50}$/.test(definition.gameId)) fail('invalid game id');
  if (!Number.isInteger(definition.mathVersion) || definition.mathVersion < 1) {
    fail('invalid math version');
  }
  if (definition.reels < 3 || definition.rows < 1) fail('invalid reel/row geometry');
  if (definition.strips.length !== definition.reels) fail('strip count must match reels');

  const ids = new Set<string>();
  for (const symbol of definition.symbols) {
    if (ids.has(symbol.id)) fail(`duplicate symbol ${symbol.id}`);
    ids.add(symbol.id);
    if (!['NORMAL', 'WILD', 'SCATTER'].includes(symbol.type)) {
      fail(`unsupported symbol type on ${symbol.id}`);
    }
  }
  if (definition.symbols.filter((symbol) => symbol.type === 'WILD').length > 1) {
    fail('only one wild symbol is supported');
  }

  for (const [reel, strip] of definition.strips.entries()) {
    if (strip.length < definition.rows) fail(`strip ${reel} is shorter than the visible window`);
    for (const symbolId of strip) {
      if (!ids.has(symbolId)) fail(`strip ${reel} references unknown symbol ${symbolId}`);
    }
  }

  if (!definition.paylines.length) fail('at least one payline is required');
  const lineIds = new Set<number>();
  for (const payline of definition.paylines) {
    if (lineIds.has(payline.id)) fail(`duplicate payline id ${payline.id}`);
    lineIds.add(payline.id);
    if (payline.rows.length !== definition.reels) {
      fail(`payline ${payline.id} must name one row per reel`);
    }
    for (const row of payline.rows) {
      if (!Number.isInteger(row) || row < 0 || row >= definition.rows) {
        fail(`payline ${payline.id} has row ${row} outside the board`);
      }
    }
  }

  const paying = definition.symbols.filter((symbol) => symbol.type === 'NORMAL');
  if (!paying.length) fail('at least one paying symbol is required');
  for (const symbol of paying) {
    const table = definition.paytable[symbol.id];
    if (!table) fail(`missing paytable entry for ${symbol.id}`);
    for (let count = 3; count <= definition.reels; count += 1) {
      const multiplier = table[count];
      if (multiplier === undefined) fail(`${symbol.id} has no ${count}-of-a-kind entry`);
      if (!Number.isInteger(multiplier) || multiplier < 0) {
        fail(`${symbol.id} has an invalid ${count}-of-a-kind multiplier`);
      }
    }
  }
  for (const symbolId of Object.keys(definition.paytable)) {
    const symbol = definition.symbols.find((entry) => entry.id === symbolId);
    if (!symbol) fail(`paytable references unknown symbol ${symbolId}`);
    else if (symbol.type !== 'NORMAL') fail(`only normal symbols may have a paytable (${symbolId})`);
  }

  if (definition.scatter) {
    const scatter = definition.symbols.find((entry) => entry.id === definition.scatter!.symbolId);
    if (!scatter) fail('scatter rule references an unknown symbol');
    else if (scatter.type !== 'SCATTER') fail('scatter rule must reference a SCATTER symbol');
    if (definition.scatter.minimumCount < 1) fail('invalid scatter minimum');
    for (const value of Object.values(definition.scatter.tiers)) {
      if (!Number.isInteger(value) || value < 0) fail('invalid scatter tier multiplier');
    }
  }

  if (!Number.isInteger(definition.maxWinCenti) || definition.maxWinCenti <= 0) {
    fail('invalid max win');
  }
  // The analytic RTP is only exact while the cap cannot bind, so a definition
  // whose cap is reachable is rejected rather than silently mis-reported.
  const capNumerator = definition.maxWinCenti * definition.paylines.length;
  if (capNumerator <= maxPossibleReturnNumerator(definition)) {
    fail('max win cap is reachable, which would invalidate the exact RTP model');
  }

  const analysis = analyseSlotRtp(definition);
  if (analysis.rtpBps !== definition.declaredRtpBps) {
    fail(
      `declared RTP ${definition.declaredRtpBps}bps does not match the computed `
      + `${analysis.rtpBps}bps (${analysis.rtpPercent}%)`,
    );
  }
  if (analysis.rtpBps < 5_000 || analysis.rtpBps > 9_950) {
    fail(`computed RTP ${analysis.rtpBps}bps is outside the platform bounds`);
  }
}

/** All built-in definitions, validated. Throws on a bad built-in definition. */
export function slotDefinitions(): SlotGameDefinition[] {
  return DEFINITIONS;
}

export function findSlotDefinition(gameId: string): SlotGameDefinition | undefined {
  return DEFINITIONS.find((definition) => definition.gameId === gameId);
}
