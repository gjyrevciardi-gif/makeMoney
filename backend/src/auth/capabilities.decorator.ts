import { SetMetadata } from '@nestjs/common';
import type { Capability } from './capabilities';

export const CAPABILITIES_KEY = 'capabilities';

/**
 * Require one or more capabilities on a route. The guard resolves the role from
 * the database on every request (via `AccessGuard`), so a demoted or disabled
 * account's live token loses access immediately.
 */
export const Capabilities = (...capabilities: Capability[]) => SetMetadata(CAPABILITIES_KEY, capabilities);
