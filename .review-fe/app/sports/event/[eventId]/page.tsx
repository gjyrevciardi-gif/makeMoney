import { Suspense } from 'react';
import { AppShell } from '../../../../components/shell/app-shell';
import { EventDetail } from './event-detail';

/** Next 15 hands route params to a server component as a promise. */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return (
    <AppShell sidebar>
      <Suspense fallback={<div className="page"><span className="skeleton" style={{ height: 320 }} /></div>}>
        <EventDetail eventId={decodeURIComponent(eventId)} />
      </Suspense>
    </AppShell>
  );
}
