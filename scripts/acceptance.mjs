import { spawnSync } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  ['backend:test', ['run', 'backend:test']],
  ['games:test', ['run', 'games:test']],
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
];

const results = [];
for (const [name, args] of steps) {
  console.log(`\n=== acceptance: ${name} ===`);
  const result = spawnSync(npmCmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ name, code: result.status ?? 1 });
}

console.log('\n=== acceptance summary ===');
for (const { name, code } of results) {
  console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${name}`);
}

const failed = results.filter((r) => r.code !== 0);
if (failed.length) {
  console.log(`\n${failed.length} step(s) failed: ${failed.map((f) => f.name).join(', ')}`);
  console.log('No safety guard was bypassed to force a pass (e.g. backend:test failing on a missing _test database is reported here, not worked around).');
  process.exitCode = 1;
} else {
  console.log('\nAll steps passed.');
}
