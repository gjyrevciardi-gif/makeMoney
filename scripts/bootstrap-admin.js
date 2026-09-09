#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required');
  if (process.env.CONFIRM_ADMIN_BOOTSTRAP !== 'GRANT_ADMIN') {
    throw new Error('Set CONFIRM_ADMIN_BOOTSTRAP=GRANT_ADMIN to confirm');
  }

  await prisma.$transaction(async (tx) => {
    const existingAdmins = await tx.user.count({ where: { role: 'ADMIN' } });
    if (existingAdmins !== 0) throw new Error('Bootstrap refused: an admin already exists');
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new Error('Bootstrap refused: account does not exist');
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        targetType: 'USER',
        targetId: user.id,
        action: 'ADMIN_ROLE_GRANTED',
        result: 'BOOTSTRAP_SUCCESS',
        metadata: { method: 'controlled-bootstrap' },
      },
    });
  }, { isolationLevel: 'Serializable' });
  console.log('Admin bootstrap completed for the requested account. Disable registration now.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Admin bootstrap failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
