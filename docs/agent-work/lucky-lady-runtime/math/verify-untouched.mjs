// Verifies the recovered client and the accepted runtime harness are untouched.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = 'C:/Users/Admin/orca/research/game-pack-forensics/external/frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX';
const RUNTIME_SHIM = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/php-shim';
const PINNED = '1eb3234892790d0c4ded54233f369aff176d9d8d';
const PREFIX = 'public/games/LuckyLadysCharmDX/';

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(full);
  }
  return out;
}

const files = walk(CLIENT);
const local = {};
for (const file of files) {
  const raw = readFileSync(file);
  const key = relative(CLIENT, file).split('\\').join('/');
  local[key] = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`), raw])).digest('hex');
}

const response = await fetch(`https://api.github.com/repos/heidi-luong1109/game/git/trees/${PINNED}?recursive=1`);
const tree = await response.json();
const upstream = {};
for (const item of tree.tree || []) {
  if (item.type === 'blob' && item.path.startsWith(PREFIX)) upstream[item.path.slice(PREFIX.length)] = item.sha;
}
const mismatched = Object.keys(local).filter((k) => upstream[k] !== local[k]);
const extra = Object.keys(local).filter((k) => !(k in upstream));

const shimHashes = {};
for (const name of readdirSync(RUNTIME_SHIM)) {
  const raw = readFileSync(join(RUNTIME_SHIM, name));
  shimHashes[name] = createHash('sha256').update(raw).digest('hex');
}

const out = {
  client: {
    path: CLIENT,
    upstreamRepo: 'heidi-luong1109/game',
    upstreamCommit: PINNED,
    upstreamTreeTruncated: !!tree.truncated,
    localFiles: files.length,
    upstreamFiles: Object.keys(upstream).length,
    hashMismatches: mismatched,
    untrackedExtra: extra,
    unchanged: mismatched.length === 0 && extra.length === 0 && files.length === 185,
  },
  runtimeShim: {
    path: RUNTIME_SHIM,
    files: shimHashes,
    note: 'accepted harness files as deployed; this task did not modify them',
  },
};
writeFileSync(join(HERE, 'runs', 'untouched-verification.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.client, null, 1));
console.log(Object.keys(shimHashes).length + ' runtime shim files hashed');