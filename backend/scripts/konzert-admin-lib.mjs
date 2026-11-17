// Helpers for the concert admin-user scripts (create-concert-admin, reset-concert-admin-password).
// These manage the SINGLE admin user of the concert admin pool (AdminUserPool in konzert/template.yaml),
// which is fully separate from the student-area pool. Credentials come from the usual AWS chain.
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { cognito, stackOutputs } from './lib.mjs';

export const DEFAULT_KONZERT_STACK = process.env.KONZERT_STACK || 'laguitarrita-konzert';

// The admin pool enforces a 12-character minimum; check here too for a clear message before calling Cognito.
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeAdminUsername(username) {
  const value = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error('The username must be 3-32 characters: letters, digits, ".", "-" or "_".');
  }
  return value;
}

export function assertAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('The password must be at least 12 characters long.');
  }
}

async function adminPoolId(stack) {
  const { AdminUserPoolId } = await stackOutputs(stack);
  if (!AdminUserPoolId) throw new Error(`Stack ${stack} has no AdminUserPoolId output. Deploy the admin pool first.`);
  return AdminUserPoolId;
}

/** Creates the admin user with a permanent password (no message, no forced password change). */
export async function createConcertAdmin({ stack = DEFAULT_KONZERT_STACK, username, password }) {
  const UserPoolId = await adminPoolId(stack);
  const Username = normalizeAdminUsername(username);
  assertAdminPassword(password);
  await cognito.send(new AdminCreateUserCommand({ UserPoolId, Username, MessageAction: 'SUPPRESS' }));
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password: password, Permanent: true }));
}

/** Sets a new permanent password for the admin user and signs it out everywhere. */
export async function setConcertAdminPassword({ stack = DEFAULT_KONZERT_STACK, username, password }) {
  const UserPoolId = await adminPoolId(stack);
  const Username = normalizeAdminUsername(username);
  assertAdminPassword(password);
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password: password, Permanent: true }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username }));
}
