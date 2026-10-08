// Server-side recovery: clear an administrator's Google Authenticator when nobody in the app can
// (for example the only SUPER_ADMIN lost their phone and recovery codes). Audited. Runs against the
// database in DATABASE_URL, so only someone with server access can use it.
//
// Usage:
//   RESET_MFA_USER=<username or email> RESET_MFA_CONFIRM=YES npm run rbac:reset-mfa --workspace backend
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const identifier = (process.env.RESET_MFA_USER ?? '').trim().toLowerCase();
if (!identifier) {
  console.error('Refusing to run: set RESET_MFA_USER to the exact username or email.');
  process.exit(2);
}
if ((process.env.RESET_MFA_CONFIRM ?? '').trim().toUpperCase() !== 'YES') {
  console.error('Refusing to run: set RESET_MFA_CONFIRM=YES to confirm.');
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where: { OR: [{ username: identifier }, { email: identifier }] }, select: { id: true } });
  if (!user) {
    console.error('No such user.');
    process.exit(3);
  }
  await prisma.$transaction([
    prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.userTotp.deleteMany({ where: { userId: user.id } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({
      data: { targetType: 'USER', targetId: user.id, action: 'MFA_RESET', result: 'SUCCESS', metadata: { via: 'server-script' } },
    }),
  ]);
  console.log('Two-factor cleared and sessions signed out (audited). The account can sign in with its password and set it up again.');
} catch (error) {
  console.error(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
