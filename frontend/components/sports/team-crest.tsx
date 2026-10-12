/**
 * A neutral team crest: a plain shield with the team's initials.
 *
 * It never draws a club's real crest. When the API supplies a badge for a team,
 * pass it as `badgeUrl` and that is shown instead.
 */
export function crestInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, 3).map((word) => word.charAt(0)).join('')
    : (words[0] ?? '').slice(0, 3);
  return letters.toUpperCase();
}

export function TeamCrest({ name, badgeUrl }: { name: string; badgeUrl?: string }) {
  if (badgeUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="m-crest" src={badgeUrl} alt="" width={34} height={38} />;
  }
  return (
    <span className="m-crest" aria-hidden="true">
      <svg viewBox="0 0 32 36" focusable="false">
        <path d="M16 1.5 3 5.5v10.2c0 8.6 5.5 14.8 13 18.8 7.5-4 13-10.2 13-18.8V5.5z" style={{ fill: 'var(--ref-cell)', stroke: 'var(--ref-line)' }} strokeWidth="1.2" />
      </svg>
      <b>{crestInitials(name)}</b>
    </span>
  );
}
