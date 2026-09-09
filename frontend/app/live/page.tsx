import { Suspense } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { SportsbookView } from '../../components/sports/sportsbook-view';

/**
 * In-play events.
 *
 * The feed reports that a fixture has started but supplies no score or clock,
 * so neither is shown. Prices for a started event render as suspended, which
 * matches the backend: it refuses a stake on an event past its start time.
 */
export default function LivePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="page"><span className="skeleton" style={{ height: 320 }} /></div>}>
        <SportsbookView mode="LIVE" />
      </Suspense>
    </AppShell>
  );
}
