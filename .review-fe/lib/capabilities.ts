/**
 * Frontend capability mirror.
 *
 * Visibility only: the backend independently re-checks every privileged
 * operation, so hiding a link is convenience and never authority. Keep this in
 * step with `backend/src/auth/capabilities.ts`.
 */
export type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export type Capability =
  | 'GAME_PLAY'
  | 'GAME_ADMIN'
  | 'GAME_MATH_MANAGE'
  | 'PLAYER_POINTS_MANAGE'
  | 'USER_MANAGE'
  | 'ADMIN_MANAGE'
  | 'SUPER_ADMIN_MANAGE'
  | 'AUDIT_VIEW'
  | 'PLATFORM_MANAGE'
  | 'SELF_SERVICE';

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  USER: ['GAME_PLAY', 'SELF_SERVICE'],
  ADMIN: [
    'GAME_PLAY',
    'GAME_ADMIN',
    'GAME_MATH_MANAGE',
    'PLAYER_POINTS_MANAGE',
    'USER_MANAGE',
    'AUDIT_VIEW',
    'SELF_SERVICE',
  ],
  SUPER_ADMIN: [
    'GAME_PLAY',
    'GAME_ADMIN',
    'GAME_MATH_MANAGE',
    'PLAYER_POINTS_MANAGE',
    'USER_MANAGE',
    'ADMIN_MANAGE',
    'SUPER_ADMIN_MANAGE',
    'AUDIT_VIEW',
    'PLATFORM_MANAGE',
    'SELF_SERVICE',
  ],
};

export function hasCapability(role: Role | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function canAccessAdminUi(role: Role | undefined): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].some((capability) =>
    ['GAME_ADMIN', 'GAME_MATH_MANAGE', 'PLAYER_POINTS_MANAGE', 'USER_MANAGE', 'AUDIT_VIEW', 'PLATFORM_MANAGE'].includes(
      capability,
    ),
  );
}
