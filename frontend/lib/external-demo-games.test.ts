import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_DEMO_GAMES,
  EXTERNAL_DEMO_HOST_ALLOWLIST,
  assertSafeDemoUrl,
  filterExternalDemoGames,
  isAllowedDemoUrl,
  matchesExternalDemoSearch,
  validateExternalDemoGames,
  type ExternalDemoGame,
} from './external-demo-games.ts';

const sample = (overrides: Partial<ExternalDemoGame> = {}): ExternalDemoGame => ({
  id: 'external:test-provider:test-game',
  provider: 'Test Provider',
  name: 'Test Game',
  demoUrl: 'https://www.playngo.com/game-demo/reactoonz',
  category: 'SLOTS',
  description: 'A description.',
  keywords: ['test'],
  artKey: 'olympus',
  external: true,
  demoOnly: true,
  verifiedVia: 'manual check',
  verifiedOn: '2026-09-11',
  ...overrides,
});

test('the shipped registry is non-empty and valid', () => {
  assert.ok(EXTERNAL_DEMO_GAMES.length > 0);
  assert.doesNotThrow(() => validateExternalDemoGames(EXTERNAL_DEMO_GAMES));
});

test('every shipped demo is marked external and demo-only', () => {
  for (const game of EXTERNAL_DEMO_GAMES) {
    assert.equal(game.external, true, game.id);
    assert.equal(game.demoOnly, true, game.id);
  }
});

test('every shipped demo points at an allowlisted host over https', () => {
  for (const game of EXTERNAL_DEMO_GAMES) {
    const url = assertSafeDemoUrl(game.demoUrl, game.id);
    assert.equal(url.protocol, 'https:', game.id);
    assert.ok(EXTERNAL_DEMO_HOST_ALLOWLIST.includes(url.hostname), `${game.id} -> ${url.hostname}`);
  }
});

test('shipped demo ids are namespaced so they cannot collide with internal game ids', () => {
  // The internal registry uses bare ids such as `dice`. A demo id must never
  // look like one, or it could be mistaken for a game we settle.
  const internalIds = ['dice', 'mines', 'roulette', 'blackjack', 'crash', 'plinko', 'fools-gold-rush'];
  for (const game of EXTERNAL_DEMO_GAMES) {
    assert.ok(game.id.startsWith('external:'), game.id);
    assert.ok(!internalIds.includes(game.id), game.id);
  }
});

test('shipped demos carry no stake, payout, RTP, fairness or version fields', () => {
  // Guards against someone copying an internal registry entry as a starting
  // point and dragging accounting-shaped metadata in with it.
  const forbidden = [
    'minStake', 'maxStake', 'payout', 'rtp', 'rtpBps', 'gameVersion',
    'supportsFairness', 'serverSeed', 'serverSeedHash', 'route', 'gameType',
  ];
  for (const game of EXTERNAL_DEMO_GAMES) {
    for (const key of forbidden) {
      assert.ok(!(key in game), `${game.id} must not carry ${key}`);
    }
  }
});

test('a demo URL on a non-allowlisted host is rejected', () => {
  for (const host of [
    'https://evil.example.com/demo',
    'https://pragmaticplay.com.evil.example/demo',
    'https://notplayngo.com/game-demo/x',
    'https://www.pragmaticplay.com.attacker.test/en/games/x/',
  ]) {
    assert.equal(isAllowedDemoUrl(host), false, host);
    assert.throws(() => validateExternalDemoGames([sample({ demoUrl: host })]));
  }
});

test('non-https schemes are rejected', () => {
  for (const url of [
    'http://www.playngo.com/game-demo/reactoonz',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'file:///etc/passwd',
  ]) {
    assert.equal(isAllowedDemoUrl(url), false, url);
  }
});

test('credentials, ports, query strings and fragments are rejected', () => {
  // A demo link never needs any of these, and refusing them removes the route
  // by which a token or session value could later be appended to an outbound URL.
  for (const url of [
    'https://user:pass@www.playngo.com/game-demo/reactoonz',
    'https://www.playngo.com:8443/game-demo/reactoonz',
    'https://www.playngo.com/game-demo/reactoonz?token=abc123',
    'https://www.playngo.com/game-demo/reactoonz#access_token=abc123',
  ]) {
    assert.equal(isAllowedDemoUrl(url), false, url);
  }
});

test('malformed URLs are rejected rather than thrown raw', () => {
  assert.equal(isAllowedDemoUrl('not-a-url'), false);
  assert.equal(isAllowedDemoUrl(''), false);
  assert.throws(() => assertSafeDemoUrl('not-a-url', 'x'), /malformed/);
});

test('metadata validation rejects incomplete or mislabelled entries', () => {
  assert.throws(() => validateExternalDemoGames([sample({ id: 'dice' })]), /namespaced id/);
  assert.throws(() => validateExternalDemoGames([sample({ id: 'external:Bad Id:x' })]), /namespaced id/);
  assert.throws(() => validateExternalDemoGames([sample({ name: '  ' })]), /display metadata/);
  assert.throws(() => validateExternalDemoGames([sample({ description: '' })]), /display metadata/);
  assert.throws(() => validateExternalDemoGames([sample({ keywords: [] })]), /keywords/);
  assert.throws(() => validateExternalDemoGames([sample({ artKey: '../secret' })]), /art key/);
  assert.throws(() => validateExternalDemoGames([sample({ verifiedOn: 'yesterday' })]), /provenance/);
  assert.throws(
    () => validateExternalDemoGames([sample({ external: false as unknown as true })]),
    /external and demoOnly/,
  );
  assert.throws(
    () => validateExternalDemoGames([sample({ demoOnly: false as unknown as true })]),
    /external and demoOnly/,
  );
});

test('duplicate ids and duplicate URLs are rejected', () => {
  assert.throws(() => validateExternalDemoGames([sample(), sample()]), /Duplicate external demo id/);
  assert.throws(
    () => validateExternalDemoGames([
      sample(),
      sample({ id: 'external:test-provider:other' }),
    ]),
    /Duplicate external demo URL/,
  );
});

test('search matches name, provider and keywords, and returns nothing for a miss', () => {
  const game = EXTERNAL_DEMO_GAMES[0];
  assert.equal(matchesExternalDemoSearch(game, ''), true);
  assert.equal(matchesExternalDemoSearch(game, game.name.split(' ')[0]), true);
  assert.equal(matchesExternalDemoSearch(game, 'demo'), true);
  assert.equal(matchesExternalDemoSearch(game, 'zzzzz-no-such-game'), false);

  assert.equal(filterExternalDemoGames('zzzzz-no-such-game').length, 0);
  assert.ok(filterExternalDemoGames('').length === EXTERNAL_DEMO_GAMES.length);
});

test('search is case and whitespace insensitive', () => {
  const game = EXTERNAL_DEMO_GAMES[0];
  const token = game.name.split(' ')[0];
  assert.equal(matchesExternalDemoSearch(game, `  ${token.toUpperCase()}  `), true);
});
