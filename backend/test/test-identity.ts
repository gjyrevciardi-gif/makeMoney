import { randomUUID } from 'node:crypto';

const workerId = process.env.JEST_WORKER_ID ?? '0';
const testNamespace = process.env.TEST_RUN_NAMESPACE ?? `worker-${workerId}`;

export function uniqueTestEmail(label: string): string {
  const safeLabel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!safeLabel) {
    throw new Error('Test email labels must not be empty.');
  }

  return `${safeLabel}-${testNamespace}-${randomUUID().slice(0, 8)}@example.test`;
}
