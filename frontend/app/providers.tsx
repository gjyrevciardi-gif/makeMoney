'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BetSlipProvider } from '../lib/bet-slip';

/**
 * The single server-state client for the application.
 *
 * Created inside a component so each browser session gets its own cache and
 * nothing leaks between requests during server rendering.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Prices are refreshed on an explicit, per-query cadence rather than on
        // every focus change, so browsing never turns into a burst of requests.
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={client}>
      <BetSlipProvider>{children}</BetSlipProvider>
    </QueryClientProvider>
  );
}
