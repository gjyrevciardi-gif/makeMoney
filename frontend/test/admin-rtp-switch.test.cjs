// Focused page/action tests without a browser, backend, or new test dependency.
// A hook-state driver executes the actual page and its event handlers; React's
// server renderer checks the resulting markup. This is not DOM/browser coverage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const candidate = { candidateId: 'validated-70', status: 'VALIDATED', targetRtpPercent: 70,
  maxWinMultiplier: 50, style: 'RETENTION', modelHash: 'model', policyHash: 'policy', weights: [], reasons: [], stages: [] };
const defaultState = { mode: 'DEFAULT', version: 1, targetRtpPercent: null, note: '' };
const customState = { mode: 'CUSTOM', version: 2, targetRtpPercent: 70, maxWinMultiplier: 50,
  style: 'RETENTION', modelHash: 'model', policyHash: 'policy', note: '' };
const metrics = { requestedRtpPercent: 70, expectedRtpPercent: 70, measuredRtpPercent: 70,
  paidSessionLength: { median: 500, p90: 800 }, turnoverPts: { median: 100 },
  houseResultPts: { mean: 30, median: 30 }, fullLossStreak: { p90: 8, p95: 10 },
  drySpellDefinitions: { fullLoss: '0x', nonProfitable: '<=1x' } };
const compiled = ts.transpileModule(readFileSync(join(__dirname, '../app/admin/casino/math/page.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function mount({ active = defaultState, candidates = [], fail = null } = {}) {
  let authoritative = { ...active };
  let cursor = 0;
  let firstRender = true;
  const values = [];
  const effects = [];
  const calls = [];
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(effect) { if (firstRender) effects.push(effect); },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
  };
  const api = {
    PAYOUT_STYLES: ['RETENTION', 'BALANCED', 'VOLATILE', 'CUSTOM'], PAYOUT_MAX_WIN: [20, 50],
    percent: (value, digits = 3) => value == null ? '—' : `${value.toFixed(digits)}%`,
    points: (value) => value == null ? '—' : String(value), ratio: (value) => value == null ? '—' : String(value),
    payoutCurrent: async () => ({ active: { ...authoritative }, defaultProfile: {
      profileId: 'lucky-lady.rtp50.v1', profileHash: 'golden', rtpPercent: 50,
      maxWinMultiplier: null, maxWinScope: 'default', note: '',
    } }),
    payoutCandidates: async () => ({ candidates }), payoutHistory: async () => ({ entries: [] }),
    payoutPreview: async (id) => { calls.push(['preview', id]); return { candidate, metrics, artifactPath: '' }; },
    activatePayout: async (...args) => {
      calls.push(['activate', ...args]);
      if (fail === 'activate') throw { code: 'FAILED', message: 'activation failed' };
      authoritative = { ...customState };
      return { active: authoritative, version: 2, replay: false };
    },
    restoreDefaultPayout: async (...args) => {
      calls.push(['default', ...args]);
      if (fail === 'default') throw { code: 'FAILED', message: 'default failed' };
      authoritative = { ...defaultState, version: 3 };
      return { active: authoritative, version: 3 };
    },
  };
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === 'react') return hooks;
    if (id === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (id.endsWith('/lib/admin')) return { describeAdminError: (error) => error.message, newIdempotencyKey: () => 'ui-test-action' };
    if (id.endsWith('/lib/math-control')) return api;
    // The shared access gate has its own behaviour; the switch test only needs to know it renders.
    if (id.endsWith('/admin-access-gate')) return { AdminAccessGate: () => React.createElement('main', null, 'Administrators only') };
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(localRequire, module, module.exports);
  const page = module.exports.default;
  const render = () => { cursor = 0; const tree = page(); firstRender = false; return tree; };
  render();
  for (const effect of effects) effect();
  await flush();
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!React.isValidElement(value)) return [];
    if (typeof value.type === 'function') return nodes(value.type(value.props));
    return [value, ...nodes(value.props.children)];
  }
  const text = (value) => Array.isArray(value) ? value.map(text).join('')
    : React.isValidElement(value) ? text(value.props.children) : String(value ?? '');
  const switchNode = () => nodes(render()).find((node) => node.props.role === 'switch');
  const button = (label) => {
    const found = nodes(render()).find((node) => node.type === 'button' && text(node.props.children) === label);
    assert.ok(found, `Missing button ${label}`);
    return found;
  };
  const click = async (node) => { assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); await flush(); };
  return { calls, switchNode, button, click, html: () => renderToStaticMarkup(render()),
    on: () => switchNode().props['aria-checked'] };
}

test('default renders OFF and default RTP50', async () => {
  const ui = await mount(); assert.equal(ui.on(), false); assert.match(ui.html(), /OFF — Default RTP50/);
});
test('custom renders ON with backend RTP, MaxWin and style', async () => {
  const ui = await mount({ active: customState }); assert.equal(ui.on(), true);
  assert.match(ui.html(), /ON — Custom RTP70.00% \/ MaxWin50x \/ RETENTION/);
});
test('custom RTP0 still renders ON', async () => {
  const ui = await mount({ active: { ...customState, targetRtpPercent: 0 } });
  assert.equal(ui.on(), true); assert.match(ui.html(), /ON — Custom RTP0.00%/);
});
test('ON without a validated candidate remains OFF and makes no mutation', async () => {
  const ui = await mount({ candidates: [{ ...candidate, status: 'GENERATED' }] });
  await ui.click(ui.switchNode()); assert.equal(ui.on(), false); assert.deepEqual(ui.calls, []);
  assert.match(ui.html(), /Generate and validate a policy before enabling custom RTP control\./);
});
test('ON previews then uses existing ACTIVATE confirmation; no optimistic ON', async () => {
  const ui = await mount({ candidates: [candidate] });
  await ui.click(ui.switchNode()); assert.equal(ui.on(), false);
  assert.deepEqual(ui.calls, [['preview', candidate.candidateId]]);
  const confirm = ui.button('Confirm activate'); confirm.props.onClick();
  assert.equal(ui.on(), false); await flush(); assert.equal(ui.on(), true);
  assert.deepEqual(ui.calls[1], ['activate', candidate.candidateId, 'ui-test-action', 1]);
});
test('OFF requires confirmation, calls DEFAULT, and changes only after success', async () => {
  const ui = await mount({ active: customState });
  await ui.click(ui.switchNode()); assert.equal(ui.on(), true); assert.deepEqual(ui.calls, []);
  assert.match(ui.html(), /New: Default lucky-lady.rtp50.v1/);
  assert.match(ui.html(), /Existing rounds and feature chains remain locked to their originating policy/);
  ui.button('CONFIRM OFF').props.onClick(); assert.equal(ui.on(), true);
  await flush(); assert.equal(ui.on(), false); assert.deepEqual(ui.calls, [['default', 'ui-test-action', 2]]);
});
test('failed OFF remains authoritative ON', async () => {
  const ui = await mount({ active: customState, fail: 'default' });
  await ui.click(ui.switchNode()); await ui.click(ui.button('CONFIRM OFF'));
  assert.equal(ui.on(), true); assert.match(ui.html(), /default failed/);
});
test('failed ON remains authoritative OFF', async () => {
  const ui = await mount({ candidates: [candidate], fail: 'activate' });
  await ui.click(ui.switchNode()); await ui.click(ui.button('Confirm activate'));
  assert.equal(ui.on(), false); assert.match(ui.html(), /activation failed/);
});
test('existing Generate, Preview, Activate and Rollback controls remain', async () => {
  const ui = await mount({ candidates: [candidate] });
  ui.button('GENERATE'); ui.button('Preview'); ui.button('ROLLBACK previous');
  await ui.click(ui.button('Preview')); ui.button('ACTIVATE');
});
test('cancelling OFF preserves ON without a backend mutation', async () => {
  const ui = await mount({ active: customState });
  await ui.click(ui.switchNode()); await ui.click(ui.button('CANCEL'));
  assert.equal(ui.on(), true); assert.deepEqual(ui.calls, []);
});
