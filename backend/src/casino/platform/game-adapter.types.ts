import { CasinoGameType, Prisma } from '@prisma/client';

/** Injection token for the shared services every adapter composes. */
export const GAME_PLATFORM = 'GAME_PLATFORM';
/** Injection token for the registry's availability switch. */
export const GAME_AVAILABILITY = 'GAME_AVAILABILITY';
/** Injection token for the operator's playability state. */
export const GAME_PLAYABILITY = 'GAME_PLAYABILITY';

/**
 * The reusable casino game-integration surface.
 *
 * Everything a recovered third-party game needs from Fool's Gold - identity,
 * ownership, a one-time launch capability, a bound game session, the
 * authoritative wallet and ledger, idempotent request replay, prepared-outcome
 * durability, presentation receipts and round ownership - is provided by the
 * shared services in this directory.
 *
 * A game adapter owns only what is genuinely its own: its protocol event
 * names, its validation, its canonical request semantics, its game rules and
 * the shape of its own recovery payload. No shared code knows a game's event
 * names, so a second game plugs in without touching this layer.
 */

/** Identity of the acting player, always derived from the server, never the body. */
export type GameActionContext = {
  readonly gameId: string;
  readonly userId: string;
  readonly sessionId: string;
};

/** One validated, authenticated game request. */
export type GameRequest = {
  readonly event: string;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string | undefined>;
  /** Server-issued identity of this action; the idempotency key is derived from it. */
  readonly requestId: string;
};

export type GameAdapter = {
  /** Registry id of the game this adapter serves. */
  readonly gameId: string;

  /**
   * The adapter's own event names that never mutate money, feature or round
   * state: reads, refreshes and presentation receipts. Everything else is
   * treated as gameplay and must carry a request identity and pass the
   * receipt gate.
   */
  readonly readOnlyEvents: readonly string[];

  /**
   * Validates an untrusted body and reports which of the adapter's events it
   * is. Must throw for an unknown event or an unexpected field.
   */
  validateRequest(body: Record<string, unknown>): string;

  /**
   * Canonical, order-independent semantics of a validated action. Two requests
   * with the same identity and the same canonical semantics are the same
   * request; different semantics under one identity is a conflict.
   */
  canonicalizeAction(
    context: GameActionContext,
    event: string,
    body: Record<string, unknown>,
  ): string;

  /** Reads and presentation receipts. Never moves money or advances a feature. */
  read(
    context: GameActionContext,
    event: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;

  /**
   * One gameplay mutation.
   *
   * The adapter decides when settlement is valid and calls the shared wallet
   * for every movement, inside its own serialized transaction, so the round,
   * the ledger and the cached response commit together.
   */
  execute(context: GameActionContext, request: GameRequest): Promise<unknown>;

  /**
   * Settles anything already durably prepared for this player without drawing
   * new randomness. Called before any authoritative state is served.
   */
  reconcilePrepared(context: GameActionContext): Promise<void>;
};

/** Availability switch owned by the platform registry, keyed by game id. */
export type GameAvailability = {
  assertEnabled(gameId: string): unknown;
};

/** Operator-controlled playability (enabled, maintenance, active maths). */
export type GamePlayability = {
  assertPlayable(gameId: string): Promise<unknown>;
};

/** The shared services every adapter composes, injected as one unit. */
export type GamePlatform = {
  readonly capabilities: GameCapabilityPort;
  readonly wallet: GameWalletPort;
  readonly journal: GameJournalPort;
  readonly rounds: GameRoundPort;
};

/**
 * Ports keep the adapters honest about the boundary: an adapter may only use
 * these operations, and nothing here can be reached from a browser body.
 */
export type GameCapabilityPort = {
  requirePlayer(userId: string, gameId: string): Promise<unknown>;
  issueLaunch(actorId: string, options: LaunchOptions): Promise<LaunchGrant>;
  exchangeLaunch(token: string, options: ExchangeOptions): Promise<GameSessionGrant>;
  assertSession(token: string, gameId: string): Promise<SessionIdentity>;
};

export type LaunchOptions = {
  gameId: string;
  /** Capability scope; encodes the game and the single action it authorizes. */
  scope: string;
  ttlMs: number;
  /** Path on the game origin that consumes the capability. */
  path?: string;
  /** Static prefix of the recovered client on the game origin. */
  gamePath?: string;
};

export type LaunchGrant = {
  token: string;
  expiresAt: string;
  /** Path on the game origin that consumes the capability. */
  path: string;
  /** Static prefix of the recovered client on the game origin. */
  gamePath: string;
};

export type ExchangeOptions = {
  gameId: string;
  scope: string;
  sessionTtlMs: number;
};

export type GameSessionGrant = {
  userId: string;
  sessionId: string;
  sessionToken: string;
};

export type SessionIdentity = {
  userId: string;
  sessionId: string;
};

export type GameWalletPort = {
  balance(tx: Pick<TransactionClient, 'wallet'>, userId: string): Promise<bigint>;
  balancePoints(tx: Pick<TransactionClient, 'wallet'>, userId: string): Promise<number>;
  debit(tx: WalletClient, params: WalletMovement): Promise<void>;
  credit(tx: WalletClient, params: WalletMovement): Promise<void>;
  refund(tx: WalletClient, params: WalletMovement): Promise<void>;
};

export type GameJournalPort = {
  requestKey(userId: string, requestId: string): string;
  unscopedRequestId(userId: string, requestKey: string): string;
  deliveringView(requestId: string, event: string): GameReceipt;
  conflict(code: string, message: string): Error;
  conflictSemantics(): never;
  serialized<T>(gameId: string, userId: string, work: (tx: TransactionClient) => Promise<T>): Promise<T>;
  findReplay(gameId: string, userId: string, requestId: string, canonical: string): Promise<unknown | null>;
  findReplayIn(
    db: ReadClient,
    gameId: string,
    userId: string,
    requestId: string,
    canonical: string,
  ): Promise<unknown | null>;
  bookAction(
    tx: TransactionClient,
    params: {
      gameId: string;
      userId: string;
      roundId: string;
      event: string;
      requestId: string;
      canonical: string;
      response: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>>;
  receipt(db: ReadClient, gameId: string, userId: string): Promise<GameReceipt>;
  assertReceiptIn(tx: TransactionClient, gameId: string, userId: string): Promise<void>;
  acknowledge(
    gameId: string,
    userId: string,
    actionId: string,
  ): Promise<{ actionId: string; accepted: boolean; reason?: string }>;
  prepareOutcome(tx: TransactionClient, outcome: NewPreparedOutcome): Promise<void>;
  findPrepared(userId: string, requestKey: string): Promise<PreparedOutcome | null>;
  findPreparedIn(
    tx: TransactionClient,
    requestKey: string,
    userId?: string,
  ): Promise<PreparedOutcome | null>;
  assertNoForeignPrepared(
    tx: TransactionClient,
    gameId: string,
    userId: string,
    requestKey: string,
  ): Promise<void>;
  listPrepared(userId: string, gameId: string): Promise<PreparedOutcomeSummary[]>;
  deletePrepared(tx: TransactionClient, requestKey: string): Promise<void>;
  discardPrepared(gameId: string, userId: string, requestKey: string): Promise<void>;
};

export type GameRoundPort = {
  currentRound(db: ReadClient, gameId: string, userId: string): Promise<RoundRow | null>;
  currentRoundIn(tx: TransactionClient, gameId: string, userId: string): Promise<RoundRow | null>;
  createRound(tx: TransactionClient, params: NewRound): Promise<{ id: string; settledAt: Date | null }>;
  persistRound(
    tx: TransactionClient,
    round: { id: string; settledAt: Date | null },
    params: RoundProjection,
  ): Promise<void>;
  ownedRound(userId: string, gameId: string, roundId: string): Promise<RoundRow>;
};

export type GameReceipt = {
  actionId: string | null;
  event: string | null;
  delivered: boolean;
  acked: boolean;
};

export type WalletMovement = {
  walletId: string;
  userId: string;
  roundId: string;
  amount: bigint;
  reason: string;
  /** Ledger idempotency key: the same key can never move money twice. */
  key: string;
  sessionId?: string | null;
  actionId?: string | null;
};

export type NewPreparedOutcome = {
  gameId: string;
  userId: string;
  requestKey: string;
  kind: string;
  canonical: string;
  sessionId: string | null;
  actionId: string;
  body: unknown;
  payload: unknown;
  roundId?: string | null;
  originRoundId: string | null;
  originVersion: number;
  originPhase: string;
};

export type PreparedOutcome = {
  requestKey: string;
  kind: string;
  canonical: string;
  sessionId: string | null;
  actionId: string;
  originRoundId: string | null;
  originVersion: number | null;
  originPhase: string | null;
  payload: unknown;
};

export type PreparedOutcomeSummary = {
  requestKey: string;
  kind: string;
};

export type NewRound = {
  id: string;
  userId: string;
  gameId: string;
  gameVersion: string;
  gameType: CasinoGameType;
  stake: bigint;
  publicState: unknown;
  privateState: unknown;
  clientSeed: string;
};

export type RoundProjection = {
  status: 'OPEN' | 'WON' | 'LOST' | 'CASHED_OUT' | 'CANCELLED';
  payout: bigint;
  publicState: unknown;
  privateState: unknown;
  settled: boolean;
};

export type RoundRow = {
  id: string;
  status: string;
  settledAt: Date | null;
  publicState: unknown;
  privateState: unknown;
};

/**
 * Prisma client aliases.
 *
 * The shared layer is written against the platform's own database client, so a
 * second game reuses the exact same tables and the exact same transaction
 * semantics instead of inventing a parallel store.
 */
export type TransactionClient = Prisma.TransactionClient;

export type ReadClient = Pick<
  TransactionClient,
  'casinoRound' | 'casinoRoundAction' | 'gamePreparedOutcome' | 'wallet'
>;

export type WalletClient = Pick<TransactionClient, 'wallet' | 'ledgerEntry' | 'casinoTransaction'>;
