import { Suspense } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { SportsbookView } from '../../components/sports/sportsbook-view';

/**
 * The sportsbook.
 *
 * The view reads the selected sport from the URL, so it is wrapped in a
 * Suspense boundary as Next requires for `useSearchParams`.
 */
export default function SportsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="page"><span className="skeleton" style={{ height: 320 }} /></div>}>
        <SportsbookView mode="PREMATCH" />
      </Suspense>
    </AppShell>
  );
}
