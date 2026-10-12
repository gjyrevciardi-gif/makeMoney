// Admin password UI after the reversible vault was removed.
// Executes the real users page with a hook-state driver. No browser and no backend.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const pageSource = readFileSync(join(__dirname, '../app/admin/users/page.tsx'), 'utf8');
const adminSource = readFileSync(join(__dirname, '../lib/admin.ts'), 'utf8');
const compiled = ts.transpileModule(pageSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

const storage = { local: {}, session: {} };
function installStorage() {
  storage.local = {};
  storage.session = {};
  const make = (bag) => ({
    setItem(key, value) { bag[key] = String(value); },
    getItem(key) { return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null; },
    removeItem(key) { delete bag[key]; },
    clear() { for (const key of Object.keys(bag)) delete bag[key]; },
  });
  global.localStorage = make(storage.local);
  global.sessionStorage = make(storage.session);
}

const listUser = {
  id: 'user-1', username: 'ada', role: 'USER', createdAt: '2026-01-01T00:00:00.000Z', wallet: { balance: '500000' },
};
const detail = { user: listUser, ledger: [], sportsBets: [], casinoRounds: [] };

function mount() {
  installStorage();
  let cursor = 0;
  let firstRender = true;
  const values = [];
  const effects = [];
  const calls = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(effect) { if (firstRender) effects.push(effect); },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
  };
  const localRequire = (id) => {
    if (id === 'react') return hooks;
    if (id === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (id.endsWith('/lib/admin')) {
      return {
        adminGet: async (path) => {
          calls.push(['GET', path]);
          if (String(path).includes('/detail')) return detail;
          if (String(path).startsWith('/admin/users')) return [listUser];
          return null;
        },
        adminSend: async (path, method, body) => {
          calls.push([method, path, body ?? null]);
          if (String(path).includes('/password/reveal')) throw new Error('reveal endpoint must not be called');
          if (path === '/admin/users' && method === 'POST') {
            const generated = body?.password ? undefined : 'One-Time-Secret-9';
            return { id: 'user-2', username: body.username, role: body.role ?? 'USER', ...(generated ? { generatedPassword: generated } : {}) };
          }
          if (String(path).endsWith('/password')) return { id: 'user-1' };
          return { id: 'user-1' };
        },
        describeAdminError: (error) => error?.message ?? 'failed',
        formatPoints: (value) => String(value),
        newIdempotencyKey: () => 'ui-test-action',
      };
    }
    if (id.endsWith('/admin-access-gate')) return { AdminAccessGate: () => React.createElement('main', null, 'Administrators only') };
    if (id.endsWith('/lib/capabilities')) return { hasCapability: () => true };
    if (id.endsWith('/lib/format')) return { displayName: (user) => user?.username ?? user?.email ?? '—', roleLabel: (role) => role };
    if (id.endsWith('/lib/queries')) return {
      useSession: () => ({ data: { role: 'SUPER_ADMIN' }, isPending: false }),
      useWallet: () => ({ data: { balance: '1000' }, refetch() {} }),
    };
    return require(id);
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(localRequire, module, module.exports);
  const page = module.exports.default;
  const render = () => { cursor = 0; const tree = page(); firstRender = false; return tree; };
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!React.isValidElement(value)) return [];
    if (typeof value.type === 'function') return nodes(value.type(value.props));
    return [value, ...nodes(value.props.children)];
  }
  const text = (value) => Array.isArray(value) ? value.map(text).join('')
    : React.isValidElement(value) ? text(value.props.children) : String(value ?? '');
  const button = (label) => {
    const found = nodes(render()).find((node) => node.type === 'button' && text(node.props.children).trim() === label);
    assert.ok(found, `Missing button ${label}`);
    return found;
  };
  const field = (labelStart) => {
    const label = nodes(render()).find((node) => node.type === 'label' && text(node.props.children).includes(labelStart));
    assert.ok(label, `Missing field ${labelStart}`);
    const input = nodes(label).find((node) => node.type === 'input' || node.type === 'select');
    assert.ok(input, `Missing input for ${labelStart}`);
    return input;
  };
  const row = () => {
    const found = nodes(render()).find((node) => node.type === 'button' && node.props.className === 'admin-user-select');
    assert.ok(found, 'user row missing');
    return found;
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const click = async (node) => { node.props.onClick(); await flush(); };
  render();
  for (const effect of effects) effect();
  return { calls, button, field, row, click, flush, html: () => renderToStaticMarkup(render()) };
}

test('the users page no longer calls the deleted reveal endpoint', () => {
  assert.equal(pageSource.includes('/password/reveal'), false);
  assert.equal(pageSource.includes('Show password'), false);
  assert.equal(pageSource.includes('Reveal Password'), false);
  assert.equal(pageSource.includes('show it again later'), false);
  assert.equal(adminSource.includes('PASSWORD_NOT_AVAILABLE'), false);
  // MFA enrollment still reports this code. It is not a password-reveal helper.
  assert.equal(adminSource.includes('PASSWORD_VAULT_NOT_CONFIGURED'), true);
});

test('generated password is shown once from the create response and then dismissed', async () => {
  const ui = await mount();
  await ui.flush();
  assert.equal(ui.html().includes('Show password'), false);
  ui.field('Username (3-32').props.onChange({ target: { value: 'newplayer' } });
  await ui.click(ui.button('Create user'));
  const shown = ui.html();
  assert.match(shown, /One-Time-Secret-9/);
  assert.match(shown, /shown only once/);
  assert.equal(shown.includes('show it again later'), false);
  assert.equal(ui.calls.some((call) => String(call[1]).includes('/password/reveal')), false);
  await ui.click(ui.button('Dismiss'));
  assert.equal(ui.html().includes('One-Time-Secret-9'), false);
  assert.deepEqual(storage.local, {});
  assert.deepEqual(storage.session, {});
});

test('setting a password does not echo it or request the old reveal route', async () => {
  const ui = await mount();
  await ui.flush();
  await ui.click(ui.row());
  const typed = 'Reset-Pass-88';
  ui.field('New password').props.onChange({ target: { value: typed } });
  await ui.click(ui.button('Set password'));
  const html = ui.html();
  assert.match(html, /Password set/);
  assert.equal(html.includes(typed), false);
  assert.equal(ui.calls.some((call) => call[0] === 'POST' && String(call[1]).endsWith('/password')), true);
  assert.equal(ui.calls.some((call) => String(call[1]).includes('/password/reveal')), false);
  assert.deepEqual(storage.local, {});
  assert.deepEqual(storage.session, {});
});
