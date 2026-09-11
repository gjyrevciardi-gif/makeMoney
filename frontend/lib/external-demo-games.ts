/**
 * Third-party demo games shown in the lobby for preview only.
 *
 * This registry is deliberately separate from the authoritative casino registry
 * that lives on the backend. Nothing here is a Fool's Gold Club game: these
 * entries carry no stake, no RTP, no fairness commitment and no game version,
 * because no round is ever created for them. They are links to a provider's own
 * public demo page, opened in a new tab, and the only thing the product does
 * with them is render a card.
 *
 * That separation is structural rather than a convention. The data lives in the
 * frontend, is never sent to our API, and there is no code path from a demo card
 * into CasinoRound, CasinoTransaction, the ledger, RTP analytics, admin config,
 * favourites, recents, fairness verification or payouts.
 *
 * Adding a game: every URL below was confirmed to return HTTP 200 directly from
 * the provider's own domain, and the page confirmed to offer a public demo with
 * no registration. A game whose URL cannot be confirmed is not listed — it is
 * recorded in UNAVAILABLE_EXTERNAL_DEMOS instead, so the omission is visible
 * rather than silent. Never guess a slug and never point at a game-launcher or
 * API endpoint; only a provider's public, human-facing page belongs here.
 */

/** Hostnames a demo URL may point at. Anything else is rejected outright. */
export const EXTERNAL_DEMO_HOST_ALLOWLIST = Object.freeze([
  'www.pragmaticplay.com',
  'www.playngo.com',
]);

export type ExternalDemoCategory = 'SLOTS';

export type ExternalDemoGame = {
  /**
   * Namespaced so it can never be mistaken for, or collide with, an internal
   * registry id such as `dice`. Nothing consumes this id server-side.
   */
  id: string;
  provider: string;
  name: string;
  demoUrl: string;
  category: ExternalDemoCategory;
  description: string;
  keywords: string[];
  /** Selects locally drawn artwork. No provider logo or asset is used. */
  artKey: string;
  external: true;
  demoOnly: true;
  /** How this URL was confirmed, so a reviewer can repeat the check. */
  verifiedVia: string;
  verifiedOn: string;
};

/**
 * Titles deliberately left out because their public URL could not be confirmed.
 * Kept in the source so the gap is documented rather than looking like an
 * oversight, and so the next person knows what was already tried.
 */
export const UNAVAILABLE_EXTERNAL_DEMOS = Object.freeze([
  {
    name: 'Sweet Bonanza',
    provider: 'Pragmatic Play',
    reason: 'Provider returned 502 on repeat checks; a stable 200 could not be confirmed.',
  },
  {
    name: 'The Dog House',
    provider: 'Pragmatic Play',
    reason: 'Provider returned 502 on repeat checks; a stable 200 could not be confirmed.',
  },
  {
    name: 'Wolf Gold',
    provider: 'Pragmatic Play',
    reason: 'Provider returned 502 on repeat checks; a stable 200 could not be confirmed.',
  },
  {
    name: 'John Hunter and the Tomb of the Scarab Queen',
    provider: 'Pragmatic Play',
    reason: 'Provider returned 502 on repeat checks; a stable 200 could not be confirmed.',
  },
  {
    name: 'Mustang Gold',
    provider: 'Pragmatic Play',
    reason: 'Provider returned 502 on repeat checks; a stable 200 could not be confirmed.',
  },
]);

const PRAGMATIC_VERIFICATION =
  'Provider game page on pragmaticplay.com, titled "Play … Slot Demo by Pragmatic Play"; '
  + 'confirmed HTTP 200 and a public no-registration demo.';
const PLAYNGO_VERIFICATION =
  'Provider demo page on playngo.com/game-demo/…; confirmed HTTP 200 and the page\'s own '
  + 'statement that no purchase is required and no real money is involved.';

const VERIFIED_ON = '2026-09-11';

const DEFINITIONS: ExternalDemoGame[] = [
  {
    id: 'external:pragmatic-play:gates-of-olympus',
    provider: 'Pragmatic Play',
    name: 'Gates of Olympus',
    demoUrl: 'https://www.pragmaticplay.com/en/games/gates-of-olympus/',
    category: 'SLOTS',
    description: 'Tumbling reels and random multipliers on the provider\'s public demo.',
    keywords: ['gates of olympus', 'zeus', 'olympus', 'tumble', 'multiplier', 'pragmatic'],
    artKey: 'olympus',
    external: true,
    demoOnly: true,
    verifiedVia: PRAGMATIC_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:pragmatic-play:big-bass-bonanza',
    provider: 'Pragmatic Play',
    name: 'Big Bass Bonanza',
    demoUrl: 'https://www.pragmaticplay.com/en/games/big-bass-bonanza/',
    category: 'SLOTS',
    description: 'Fisherman collect feature on the provider\'s public demo.',
    keywords: ['big bass bonanza', 'bass', 'fish', 'fishing', 'bonanza', 'pragmatic'],
    artKey: 'bass',
    external: true,
    demoOnly: true,
    verifiedVia: PRAGMATIC_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:pragmatic-play:sugar-rush',
    provider: 'Pragmatic Play',
    name: 'Sugar Rush',
    demoUrl: 'https://www.pragmaticplay.com/en/games/sugar-rush/',
    category: 'SLOTS',
    description: 'Cluster pays with multiplier tiles on the provider\'s public demo.',
    keywords: ['sugar rush', 'sugar', 'candy', 'cluster', 'sweet', 'pragmatic'],
    artKey: 'sugar',
    external: true,
    demoOnly: true,
    verifiedVia: PRAGMATIC_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:pragmatic-play:starlight-princess',
    provider: 'Pragmatic Play',
    name: 'Starlight Princess',
    demoUrl: 'https://www.pragmaticplay.com/en/games/starlight-princess/',
    category: 'SLOTS',
    description: 'Pay-anywhere reels with multiplier symbols on the provider\'s public demo.',
    keywords: ['starlight princess', 'starlight', 'princess', 'anime', 'multiplier', 'pragmatic'],
    artKey: 'starlight',
    external: true,
    demoOnly: true,
    verifiedVia: PRAGMATIC_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:playn-go:rich-wilde-and-the-book-of-dead',
    provider: "Play'n GO",
    name: 'Rich Wilde and the Book of Dead',
    demoUrl: 'https://www.playngo.com/game-demo/rich-wilde-and-the-book-of-dead',
    category: 'SLOTS',
    description: 'Expanding symbol free spins on the provider\'s public demo.',
    keywords: ['book of dead', 'rich wilde', 'egypt', 'explorer', 'book', 'playn go'],
    artKey: 'book',
    external: true,
    demoOnly: true,
    verifiedVia: PLAYNGO_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:playn-go:legacy-of-dead',
    provider: "Play'n GO",
    name: 'Legacy of Dead',
    demoUrl: 'https://www.playngo.com/game-demo/legacy-of-dead',
    category: 'SLOTS',
    description: 'Egyptian free spins with expanding symbols on the provider\'s public demo.',
    keywords: ['legacy of dead', 'legacy', 'egypt', 'pharaoh', 'playn go'],
    artKey: 'legacy',
    external: true,
    demoOnly: true,
    verifiedVia: PLAYNGO_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:playn-go:reactoonz',
    provider: "Play'n GO",
    name: 'Reactoonz',
    demoUrl: 'https://www.playngo.com/game-demo/reactoonz',
    category: 'SLOTS',
    description: 'Cascading alien clusters on the provider\'s public demo.',
    keywords: ['reactoonz', 'alien', 'cluster', 'cascade', 'grid', 'playn go'],
    artKey: 'reactoonz',
    external: true,
    demoOnly: true,
    verifiedVia: PLAYNGO_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
  {
    id: 'external:playn-go:fire-joker',
    provider: "Play'n GO",
    name: 'Fire Joker',
    demoUrl: 'https://www.playngo.com/game-demo/fire-joker',
    category: 'SLOTS',
    description: 'Three-reel classic with a respin wheel on the provider\'s public demo.',
    keywords: ['fire joker', 'joker', 'fruit', 'classic', 'respin', 'playn go'],
    artKey: 'joker',
    external: true,
    demoOnly: true,
    verifiedVia: PLAYNGO_VERIFICATION,
    verifiedOn: VERIFIED_ON,
  },
];

const ID_PATTERN = /^external:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ART_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Rejects a demo URL that is anything other than a plain https link to an
 * allowlisted provider page.
 *
 * The query string and fragment are refused rather than sanitised: a demo link
 * has no legitimate need for either, and refusing them removes the whole class
 * of mistake where a token, session id or return URL is appended later and
 * quietly leaves the origin.
 */
export function assertSafeDemoUrl(rawUrl: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`External demo ${label} has a malformed demoUrl.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`External demo ${label} must use https.`);
  }
  if (!EXTERNAL_DEMO_HOST_ALLOWLIST.includes(url.hostname)) {
    throw new Error(`External demo ${label} points at a host that is not allowlisted: ${url.hostname}`);
  }
  if (url.username || url.password) {
    throw new Error(`External demo ${label} must not carry credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`External demo ${label} must not carry a query string or fragment.`);
  }
  if (url.port) {
    throw new Error(`External demo ${label} must not specify a port.`);
  }
  return url;
}

/** True when a URL would be accepted. Useful for tests and for guarding input. */
export function isAllowedDemoUrl(rawUrl: string): boolean {
  try {
    assertSafeDemoUrl(rawUrl, 'candidate');
    return true;
  } catch {
    return false;
  }
}

export function validateExternalDemoGames(games: readonly ExternalDemoGame[]): void {
  const ids = new Set<string>();
  const urls = new Set<string>();

  for (const game of games) {
    const label = game.id || '(missing id)';
    if (!ID_PATTERN.test(game.id)) {
      throw new Error(`External demo ${label} has an invalid namespaced id.`);
    }
    if (ids.has(game.id)) throw new Error(`Duplicate external demo id: ${game.id}`);

    if (game.external !== true || game.demoOnly !== true) {
      throw new Error(`External demo ${label} must be marked external and demoOnly.`);
    }
    if (!game.provider.trim() || !game.name.trim() || !game.description.trim()) {
      throw new Error(`External demo ${label} is missing display metadata.`);
    }
    if (!game.verifiedVia.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(game.verifiedOn)) {
      throw new Error(`External demo ${label} is missing verification provenance.`);
    }
    if (game.category !== 'SLOTS') {
      throw new Error(`External demo ${label} has an unsupported category.`);
    }
    if (!ART_KEY_PATTERN.test(game.artKey)) {
      throw new Error(`External demo ${label} has an invalid art key.`);
    }
    if (!Array.isArray(game.keywords)
      || game.keywords.length === 0
      || game.keywords.some((keyword) => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 64)) {
      throw new Error(`External demo ${label} has invalid keywords.`);
    }

    assertSafeDemoUrl(game.demoUrl, label);
    if (urls.has(game.demoUrl)) throw new Error(`Duplicate external demo URL: ${game.demoUrl}`);

    ids.add(game.id);
    urls.add(game.demoUrl);
  }
}

// Evaluated when the module loads, so a bad entry fails the production build
// rather than shipping a broken or unsafe link.
validateExternalDemoGames(DEFINITIONS);

export const EXTERNAL_DEMO_GAMES: readonly ExternalDemoGame[] = Object.freeze(DEFINITIONS);

export function externalDemoProviders(games: readonly ExternalDemoGame[] = EXTERNAL_DEMO_GAMES): string[] {
  return games.reduce<string[]>((providers, game) => {
    if (!providers.includes(game.provider)) providers.push(game.provider);
    return providers;
  }, []);
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mirrors the internal lobby search so a query behaves the same across both
 * lists, while the results stay in their own clearly labelled group.
 */
export function matchesExternalDemoSearch(game: ExternalDemoGame, value: string): boolean {
  const search = normalize(value);
  if (!search) return true;

  const haystack = normalize([
    game.name,
    game.provider,
    game.description,
    game.category,
    'demo',
    'external',
    ...game.keywords,
  ].join(' '));

  return search.split(' ').every((token) => haystack.includes(token));
}

export function filterExternalDemoGames(
  search: string,
  games: readonly ExternalDemoGame[] = EXTERNAL_DEMO_GAMES,
): ExternalDemoGame[] {
  return games.filter((game) => matchesExternalDemoSearch(game, search));
}
