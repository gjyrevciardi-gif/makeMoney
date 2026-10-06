import { Role } from '@prisma/client';

/**
 * Central capability catalogue and the single role -> capability mapping.
 *
 * The rest of the platform asks "does this role hold this capability" instead
 * of comparing role names directly, so a new role can be added without hunting
 * down scattered `role === ADMIN` checks. The mapping is the authorization
 * contract: SUPER_ADMIN holds everything; ADMIN holds the operational admin
 * capabilities; USER holds play and self-service.
 */
export const CAPABILITIES = [
  /** Play any integrated game (all authenticated roles). */
  'GAME_PLAY',
  /** Game catalogue / configuration administration. */
  'GAME_ADMIN',
  /** Game mathematics control (generate/validate/activate). */
  'GAME_MATH_MANAGE',
  /** Grant/remove player points through the append-only ledger. */
  'PLAYER_POINTS_MANAGE',
  /** Manage USER-level accounts (never higher roles). */
  'USER_MANAGE',
  /** Manage ADMIN-level accounts. */
  'ADMIN_MANAGE',
  /** Manage SUPER_ADMIN accounts (promote/demote/disable). */
  'SUPER_ADMIN_MANAGE',
  /** Read the administrative audit trail. */
  'AUDIT_VIEW',
  /** Platform-wide switches: maintenance, sports operations, providers. */
  'PLATFORM_MANAGE',
  /** A user's access to their own data (own rounds, history, wallet). */
  'SELF_SERVICE',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const USER_CAPABILITIES: readonly Capability[] = ['GAME_PLAY', 'SELF_SERVICE'];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  'GAME_PLAY',
  'GAME_ADMIN',
  'GAME_MATH_MANAGE',
  'PLAYER_POINTS_MANAGE',
  'USER_MANAGE',
  'AUDIT_VIEW',
  'SELF_SERVICE',
];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  USER: USER_CAPABILITIES,
  ADMIN: ADMIN_CAPABILITIES,
  SUPER_ADMIN: CAPABILITIES,
};

export function capabilitiesFor(role: Role | null | undefined): Capability[] {
  if (!role) return [];
  return [...(ROLE_CAPABILITIES[role] ?? [])];
}

export function hasCapability(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}

export function hasAnyCapability(role: Role | null | undefined, capabilities: readonly Capability[]): boolean {
  if (!role) return false;
  const held = ROLE_CAPABILITIES[role] ?? [];
  return capabilities.some((capability) => held.includes(capability));
}

/**
 * True when a role may *manage* a target of the given role.
 *
 * USER: nobody may manage a USER through the role endpoints (players are not
 * administrators). ADMIN: only USER targets. SUPER_ADMIN: any target.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === Role.SUPER_ADMIN) return true;
  if (actorRole === Role.ADMIN) return targetRole === Role.USER;
  return false;
}

/** The privilege a role-change *requires* the actor to hold for the new role. */
export function capabilityForRoleGrant(role: Role): Capability {
  if (role === Role.SUPER_ADMIN) return 'SUPER_ADMIN_MANAGE';
  if (role === Role.ADMIN) return 'ADMIN_MANAGE';
  return 'USER_MANAGE';
}

/** Roles whose managed capacity must never drop to zero. */
export function isProtectedHighRole(role: Role): boolean {
  return role === Role.SUPER_ADMIN;
}
