/**
 * Presentation helpers.
 *
 * Nothing here is authoritative. Every figure a player acts on - balance, odds,
 * stake, payout - is produced and re-validated by the backend; these functions
 * only decide how an already-authoritative value is rendered.
 */

const POINTS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `12,450` - always tabular, never rounded up. */
export function formatPoints(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return POINTS.format(Math.trunc(numeric));
}

/** `12,450 pts` for places where the unit needs saying. */
export const formatPointsUnit = (value: string | number | null | undefined) =>
  `${formatPoints(value)} pts`;

/**
 * Decimal odds are shown exactly as the backend priced them, padded to two
 * decimals so a column of prices stays aligned.
 */
export function formatOdds(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toFixed(2);
}

/** Multiplies displayed odds for the slip's informational estimate only. */
export function combinedOdds(prices: (string | number)[]) {
  return prices.reduce<number>((total, price) => total * Number(price), 1);
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
const FULL = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

export const formatTime = (iso: string) => TIME.format(new Date(iso));
export const formatDay = (iso: string) => DAY.format(new Date(iso));
export const formatDateTime = (iso: string) => FULL.format(new Date(iso));

/** `Today` / `Tomorrow` / `Sat 14 Sep`, for grouping headers. */
export function formatRelativeDay(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).format(date);
}

/** Title Case for SCREAMING_SNAKE enum values coming from the API. */
export function humanize(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** First letter of an email, for the avatar. Never renders the whole address. */
export const initialOf = (email: string | undefined) =>
  (email?.trim()[0] ?? '?').toUpperCase();
