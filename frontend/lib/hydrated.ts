'use client';

import { useEffect, useState } from 'react';

/**
 * False on the server and during the first client render, true after mount.
 *
 * Data that is fetched only on the client (react-query) can already be in the
 * cache when a deferred (Suspense) boundary hydrates, so its first client render
 * would differ from the server-rendered loading state and React reports a
 * hydration mismatch. Rendering the loading state until this is true makes the
 * first client render identical to the server's, regardless of how fast the data is.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
