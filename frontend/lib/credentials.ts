/**
 * Client-side credential hints.
 *
 * The backend is the authority (login takes a username or an email, and a password
 * of at least 8 characters) and answers a bad payload with a generic 400. This only
 * mirrors those rules so the player is told what is wrong before a request is sent,
 * instead of the browser silently blocking the submit or a vague error coming back.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function credentialProblem(identifier: string, password: string): string | null {
  if (identifier.trim().length < 3) return 'Enter your username.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}
