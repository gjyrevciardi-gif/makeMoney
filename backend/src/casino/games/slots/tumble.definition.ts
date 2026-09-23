import { TumbleGameDefinition } from './tumble.types';

/**
 * Frozen tumbling-slot definitions.
 *
 * A definition is immutable: changing a weight, a band, or an orb face means
 * publishing a *new* version, never editing this one, so a settled round stays
 * reproducible from the version it recorded.
 *
 * Nothing here is derived from, or resembles, any commercial slot: the theme,
 * symbol set, weights, bands, orb faces and feature rules are original to this
 * project. The *class* of game - pays anywhere, tumbling, multiplier orbs, a
 * scatter-triggered free spin session - is a common mechanic, not an asset.
 */

/**
 * Titan's Tempest - original storm/temple theme, 6 reels x 5 rows, pays anywhere.
 *
 * Eight or more of one symbol anywhere on the board pay on the total bet. Paying
 * symbols are then removed, everything above them falls, and fresh symbols drop
 * in; the chain repeats until a drop pays nothing. Multiplier orbs land on the
 * board, never pay by themselves, survive the whole chain, and their faces are
 * summed and applied to that spin's symbol wins. Four scatters open a free-spin
 * session in which those orb sums accumulate across the session instead of
 * resetting each spin.
 */
export const TITANS_TEMPEST_V1: TumbleGameDefinition = {
  gameId: 'titans-tempest',
  name: 'Titan’s Tempest',
  description:
    'Six reels, five rows, pays anywhere. Tumbling wins, storm orbs, and a free-spin '
    + 'session with a multiplier that never resets.',
  mathVersion: 1,
  reels: 6,
  rows: 5,
  symbols: [
    // Order matters only for presentation; wins are counted per symbol, so two
    // symbols can never compete for the same cell. `code` is the character a
    // board row is encoded with on the wire.
    { id: 'CROWN', name: 'Laurel Crown', type: 'PAY', code: 'C' },
    { id: 'HOURGLASS', name: 'Aeon Glass', type: 'PAY', code: 'H' },
    { id: 'SIGNET', name: 'Storm Signet', type: 'PAY', code: 'S' },
    { id: 'CHALICE', name: 'Bronze Chalice', type: 'PAY', code: 'L' },
    { id: 'GEM_ROSE', name: 'Rose Gem', type: 'PAY', code: 'r' },
    { id: 'GEM_VIOLET', name: 'Violet Gem', type: 'PAY', code: 'v' },
    { id: 'GEM_AMBER', name: 'Amber Gem', type: 'PAY', code: 'a' },
    { id: 'GEM_VERDANT', name: 'Verdant Gem', type: 'PAY', code: 'g' },
    { id: 'GEM_AZURE', name: 'Azure Gem', type: 'PAY', code: 'b' },
    { id: 'SIGIL', name: 'Tempest Sigil', type: 'SCATTER', code: 'X' },
    { id: 'ORB', name: 'Storm Orb', type: 'ORB', code: 'O' },
  ],
  // Out of 1000. Premiums are rare enough that a 12+ band is a genuine event.
  symbolWeights: {
    CROWN: 42,
    HOURGLASS: 55,
    SIGNET: 68,
    CHALICE: 85,
    GEM_ROSE: 110,
    GEM_VIOLET: 130,
    GEM_AMBER: 150,
    GEM_VERDANT: 170,
    GEM_AZURE: 190,
  },
  minCluster: 8,
  // Centi of ONE BET. Bands are declared highest-first and read in that order.
  // These values were set by simulation, not by taste: at these weights the
  // board pays a cluster often enough that the bands have to sit well below a
  // payline game's, or the return would land far above the platform ceiling.
  paytable: {
    CROWN: [{ min: 12, centi: 1_800 }, { min: 10, centi: 900 }, { min: 8, centi: 350 }],
    HOURGLASS: [{ min: 12, centi: 900 }, { min: 10, centi: 350 }, { min: 8, centi: 90 }],
    SIGNET: [{ min: 12, centi: 500 }, { min: 10, centi: 175 }, { min: 8, centi: 70 }],
    CHALICE: [{ min: 12, centi: 420 }, { min: 10, centi: 70 }, { min: 8, centi: 50 }],
    GEM_ROSE: [{ min: 12, centi: 350 }, { min: 10, centi: 50 }, { min: 8, centi: 35 }],
    GEM_VIOLET: [{ min: 12, centi: 280 }, { min: 10, centi: 42 }, { min: 8, centi: 28 }],
    GEM_AMBER: [{ min: 12, centi: 175 }, { min: 10, centi: 35 }, { min: 8, centi: 18 }],
    GEM_VERDANT: [{ min: 12, centi: 140 }, { min: 10, centi: 30 }, { min: 8, centi: 14 }],
    GEM_AZURE: [{ min: 12, centi: 70 }, { min: 10, centi: 26 }, { min: 8, centi: 9 }],
  },
  // Out of 1000, drawn once per reel on the opening drop only. At most one
  // scatter per reel, so the trigger count is a clean Binomial(6, 0.14) and the
  // session cannot be opened by a tumble refill.
  scatterReelWeight: 140,
  // Out of 10000, drawn for every cell that is filled or refilled.
  orbWeight: 250,
  orbFaces: [
    { value: 2, weight: 3_000 },
    { value: 3, weight: 2_000 },
    { value: 4, weight: 1_300 },
    { value: 5, weight: 1_100 },
    { value: 6, weight: 800 },
    { value: 8, weight: 600 },
    { value: 10, weight: 500 },
    { value: 12, weight: 300 },
    { value: 15, weight: 200 },
    { value: 20, weight: 100 },
    { value: 25, weight: 60 },
    { value: 50, weight: 25 },
    { value: 100, weight: 10 },
    { value: 250, weight: 4 },
    { value: 500, weight: 1 },
  ],
  // Centi of one bet. Never multiplied by orbs.
  scatterPay: { 4: 100, 5: 175, 6: 3_500 },
  freeSpins: {
    trigger: 4,
    award: 15,
    retrigger: 3,
    retriggerAward: 5,
    maxSpins: 500,
  },
  // 90x the bet. Priced from simulation so buying is not a worse deal than
  // waiting: a session returns ~86x the bet on average, which at this price is
  // a shade above the base game's return rather than well below it.
  buyFeatureCenti: 9_000,
  maxWinCenti: 1_500_000,
  maxTumbles: 60,
  volatility: 'HIGH',
  // Simulated, not enumerated: a tumble chain has no closed form. Measured at
  // 9514bps over 6,000,000 rounds (four seeds, 1,500,000 each, spread 9422 to
  // 9606), with a 33.6% hit rate and the feature opening about once in 219
  // spins. `tumble.rtp.ts` reproduces it and the test suite pins an exact
  // golden figure so the definition cannot drift away unnoticed.
  declaredRtpBps: 9_500,
};

const DEFINITIONS: TumbleGameDefinition[] = [TITANS_TEMPEST_V1];

/**
 * Deterministic version identity, e.g. `titans-tempest.v1.rtp9500`.
 * The declared RTP is part of the identity, so a maths change forces a new one.
 */
export function tumbleVersion(definition: TumbleGameDefinition): string {
  return `${definition.gameId}.v${definition.mathVersion}.rtp${definition.declaredRtpBps}`;
}

export class TumbleDefinitionError extends Error {}

/** Total drawing weight of the paying symbols. */
export function symbolWeightTotal(definition: TumbleGameDefinition): number {
  return Object.values(definition.symbolWeights).reduce((sum, weight) => sum + weight, 0);
}

export function orbWeightTotal(definition: TumbleGameDefinition): number {
  return definition.orbFaces.reduce((sum, face) => sum + face.weight, 0);
}

/**
 * The most one single board could pay before any multiplier, used to prove the
 * structural cap sits above an ordinary board rather than inside the paytable.
 */
export function maxBoardCenti(definition: TumbleGameDefinition): number {
  return Object.values(definition.paytable)
    .reduce((sum, bands) => sum + Math.max(...bands.map((band) => band.centi)), 0);
}

/**
 * Fail-fast structural validation.
 *
 * Runs at startup and in tests. Unlike the payline family this cannot assert an
 * exact RTP - tumbling and a cumulative session multiplier leave no closed form
 * - so the declared figure is checked for plausibility here and reproduced by
 * simulation in the test suite.
 */
export function validateTumbleDefinition(definition: TumbleGameDefinition): void {
  const fail = (message: string) => {
    throw new TumbleDefinitionError(`${definition.gameId}: ${message}`);
  };

  if (!/^[a-z0-9-]{3,50}$/.test(definition.gameId)) fail('invalid game id');
  if (!Number.isInteger(definition.mathVersion) || definition.mathVersion < 1) {
    fail('invalid math version');
  }
  if (definition.reels < 3 || definition.rows < 3) fail('invalid reel/row geometry');

  const cells = definition.reels * definition.rows;
  if (!Number.isInteger(definition.minCluster)
    || definition.minCluster < 2
    || definition.minCluster > cells) {
    fail('invalid minimum cluster size');
  }

  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const symbol of definition.symbols) {
    if (ids.has(symbol.id)) fail(`duplicate symbol ${symbol.id}`);
    ids.add(symbol.id);
    if (!['PAY', 'SCATTER', 'ORB'].includes(symbol.type)) {
      fail(`unsupported symbol type on ${symbol.id}`);
    }
    // One character per cell is what keeps a long session a normal-sized row,
    // and a duplicated code would silently merge two symbols on the wire.
    if (symbol.code.length !== 1) fail(`symbol ${symbol.id} needs a single-character code`);
    if (codes.has(symbol.code)) fail(`duplicate symbol code ${symbol.code}`);
    codes.add(symbol.code);
  }
  const paying = definition.symbols.filter((symbol) => symbol.type === 'PAY');
  if (definition.symbols.filter((symbol) => symbol.type === 'SCATTER').length !== 1) {
    fail('exactly one scatter symbol is required');
  }
  if (definition.symbols.filter((symbol) => symbol.type === 'ORB').length !== 1) {
    fail('exactly one orb symbol is required');
  }
  if (paying.length < 2) fail('at least two paying symbols are required');

  for (const symbol of paying) {
    const weight = definition.symbolWeights[symbol.id];
    if (!Number.isInteger(weight) || weight < 1) fail(`invalid weight for ${symbol.id}`);
    const bands = definition.paytable[symbol.id];
    if (!bands?.length) fail(`missing paytable bands for ${symbol.id}`);
    let previousMin = Number.POSITIVE_INFINITY;
    let previousCenti = Number.POSITIVE_INFINITY;
    for (const band of bands) {
      if (!Number.isInteger(band.min) || band.min < definition.minCluster || band.min > cells) {
        fail(`${symbol.id} has a band outside the board`);
      }
      if (!Number.isInteger(band.centi) || band.centi < 1) {
        fail(`${symbol.id} has an invalid band multiplier`);
      }
      // Bands are read highest-first, so a definition that is not strictly
      // descending would silently shadow a band and misprice the paytable.
      if (band.min >= previousMin) fail(`${symbol.id} bands must descend by count`);
      if (band.centi > previousCenti) fail(`${symbol.id} bands must not pay more for less`);
      previousMin = band.min;
      previousCenti = band.centi;
    }
    if (bands[bands.length - 1].min !== definition.minCluster) {
      fail(`${symbol.id} must have a band at the minimum cluster size`);
    }
  }
  for (const symbolId of Object.keys(definition.paytable)) {
    const symbol = definition.symbols.find((entry) => entry.id === symbolId);
    if (!symbol) fail(`paytable references unknown symbol ${symbolId}`);
    else if (symbol.type !== 'PAY') fail(`only paying symbols may have bands (${symbolId})`);
  }
  for (const symbolId of Object.keys(definition.symbolWeights)) {
    const symbol = definition.symbols.find((entry) => entry.id === symbolId);
    if (!symbol) fail(`weights reference unknown symbol ${symbolId}`);
    else if (symbol.type !== 'PAY') fail(`only paying symbols may have weights (${symbolId})`);
  }

  if (!Number.isInteger(definition.scatterReelWeight)
    || definition.scatterReelWeight < 1
    || definition.scatterReelWeight >= 1_000) {
    fail('scatter reel weight must be a proper fraction of 1000');
  }
  if (!Number.isInteger(definition.orbWeight)
    || definition.orbWeight < 1
    || definition.orbWeight >= 10_000) {
    fail('orb weight must be a proper fraction of 10000');
  }
  if (!definition.orbFaces.length) fail('at least one orb face is required');
  let previousFace = 0;
  for (const face of definition.orbFaces) {
    if (!Number.isInteger(face.value) || face.value < 2) fail('invalid orb face value');
    if (!Number.isInteger(face.weight) || face.weight < 1) fail('invalid orb face weight');
    if (face.value <= previousFace) fail('orb faces must ascend by value');
    previousFace = face.value;
  }

  for (const key of Object.keys(definition.scatterPay)) {
    const count = Number(key);
    if (!Number.isInteger(count) || count < 1 || count > definition.reels) {
      fail(`scatter pay references an impossible count ${key}`);
    }
    const centi = definition.scatterPay[count];
    if (!Number.isInteger(centi) || centi < 0) fail(`invalid scatter pay for ${key}`);
  }

  const feature = definition.freeSpins;
  if (!Number.isInteger(feature.trigger)
    || feature.trigger < 1
    || feature.trigger > definition.reels) {
    fail('invalid free spin trigger');
  }
  if (!Number.isInteger(feature.retrigger)
    || feature.retrigger < 1
    || feature.retrigger > definition.reels) {
    fail('invalid free spin retrigger');
  }
  if (!Number.isInteger(feature.award) || feature.award < 1) fail('invalid free spin award');
  if (!Number.isInteger(feature.retriggerAward) || feature.retriggerAward < 1) {
    fail('invalid retrigger award');
  }
  if (!Number.isInteger(feature.maxSpins) || feature.maxSpins < feature.award) {
    fail('invalid free spin ceiling');
  }

  if (!Number.isInteger(definition.buyFeatureCenti) || definition.buyFeatureCenti < 100) {
    fail('invalid feature price');
  }
  if (!Number.isInteger(definition.maxTumbles) || definition.maxTumbles < 1) {
    fail('invalid tumble ceiling');
  }
  if (!Number.isInteger(definition.maxWinCenti) || definition.maxWinCenti <= 0) {
    fail('invalid max win');
  }
  // A single board must not be able to reach the cap on its own, otherwise the
  // advertised ceiling would be an ordinary paytable entry in disguise.
  if (definition.maxWinCenti <= maxBoardCenti(definition)) {
    fail('max win cap is below what one board can pay');
  }
  if (!Number.isInteger(definition.declaredRtpBps)
    || definition.declaredRtpBps < 5_000
    || definition.declaredRtpBps > 9_950) {
    fail(`declared RTP ${definition.declaredRtpBps}bps is outside the platform bounds`);
  }
}

export function tumbleDefinitions(): TumbleGameDefinition[] {
  return DEFINITIONS;
}

export function findTumbleDefinition(gameId: string): TumbleGameDefinition | undefined {
  return DEFINITIONS.find((definition) => definition.gameId === gameId);
}
