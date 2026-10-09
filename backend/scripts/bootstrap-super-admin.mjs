// Explicit, audited first-SUPER_ADMIN recovery command.
//
// Promoting an account is a deliberate operator action, never automatic: the
// email must be named and the run must be confirmed. The command logic lives in
// the compiled `bootstrapSuperAdmin` (all checks inside one shared-lock
// transaction); this wrapper only handles environment, exit codes and output.
//
// Requires a build (`npm run build --workspace backend`) so the compiled module
// exists, matching the other `scripts/*.mjs` evidence commands.
//
// Usage:
//   BOOTSTRAP_SUPER_ADMIN_EMAIL=someone@example.test BOOTSTRAP_CONFIRM=YES \
//     npm run rbac:bootstrap-super-admin --workspace backend
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const email = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
const confirmed = (process.env.BOOTSTRAP_CONFIRM ?? '').trim().toUpperCase() === 'YES';

if (!email) {
  console.error('Refusing to run: set BOOTSTRAP_SUPER_ADMIN_EMAIL to the exact account email.');
  process.exit(2);
}
if (!confirmed) {
  console.error('Refusing to run: set BOOTSTRAP_CONFIRM=YES to confirm this explicit promotion.');
  process.exit(2);
}

const modulePath = join(process.cwd(), 'dist', 'src', 'auth', 'super-admin-bootstrap.js');
let bootstrapSuperAdmin;
try {
  ({ bootstrapSuperAdmin } = await import(`file://${modulePath}`));
} catch (error) {
  console.error(`Could not load the compiled bootstrap module (${modulePath}). Run "npm run build --workspace backend" first.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(4);
}

const prisma = new PrismaClient();
try {
  const outcome = await bootstrapSuperAdmin(prisma, email);
  if (outcome.status === 'PROMOTED') {
    console.log(`Promoted ${outcome.email} from ${outcome.from} to SUPER_ADMIN (audited).`);
    process.exit(0);
  }
  if (outcome.status === 'NOOP') {
    console.log(`${outcome.email} is already SUPER_ADMIN; nothing to do.`);
    process.exit(0);
  }
  console.error(`Refused (${outcome.code}): ${outcome.message}`);
  process.exit(outcome.code === 'USER_NOT_FOUND' ? 3 : 5);
} catch (error) {
  console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
