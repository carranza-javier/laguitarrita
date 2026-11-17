import { Injectable } from '@angular/core';
import type { CognitoUser, CognitoUserPool, CognitoUserSession } from 'amazon-cognito-identity-js';
import { KONZERT_ADMIN_CONFIG } from './konzert-admin-config';

export type AdminAuthErrorCode = 'credentials' | 'tooMany' | 'network' | 'sessionExpired' | 'generic';

export class AdminAuthError extends Error {
  constructor(readonly code: AdminAuthErrorCode) {
    super(code);
  }
}

export interface AdminSession {
  username: string;
}

/**
 * Cognito sign-in (SRP, the password never leaves the browser) for the private concert admin page.
 * Tokens live in sessionStorage: they survive reloads but are gone when the tab closes.
 * The Cognito library is only loaded with this route.
 */
@Injectable({ providedIn: 'root' })
export class KonzertAdminAuthService {
  private poolPromise?: Promise<CognitoUserPool>;

  private async lib() {
    // The library's Buffer polyfill expects Node's `global`.
    (globalThis as { global?: unknown }).global ??= globalThis;
    return import('amazon-cognito-identity-js');
  }

  private pool(): Promise<CognitoUserPool> {
    this.poolPromise ??= this.lib().then(
      ({ CognitoUserPool }) =>
        new CognitoUserPool({
          UserPoolId: KONZERT_ADMIN_CONFIG.userPoolId,
          ClientId: KONZERT_ADMIN_CONFIG.userPoolClientId,
          Storage: window.sessionStorage,
        }),
    );
    return this.poolPromise;
  }

  /** Returns a valid (refreshed if needed) session, or null if not signed in. */
  async currentSession(): Promise<AdminSession | null> {
    const session = await this.validSession().catch(() => null);
    return session ? toSession(session) : null;
  }

  async login(name: string, password: string): Promise<AdminSession> {
    const { AuthenticationDetails, CognitoUser } = await this.lib();
    const pool = await this.pool();
    const username = name.trim().toLowerCase();
    const user = new CognitoUser({ Username: username, Pool: pool, Storage: window.sessionStorage });
    const session = await new Promise<CognitoUserSession>((resolve, reject) =>
      user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
        onSuccess: resolve,
        onFailure: (err) => reject(mapError(err)),
        newPasswordRequired: () => reject(new AdminAuthError('generic')),
      }),
    );
    return toSession(session);
  }

  /** Access token for the API; throws AdminAuthError('sessionExpired') if it cannot be refreshed. */
  async accessToken(): Promise<string> {
    try {
      return (await this.validSession()).getAccessToken().getJwtToken();
    } catch {
      throw new AdminAuthError('sessionExpired');
    }
  }

  async logout(): Promise<void> {
    const user = (await this.pool()).getCurrentUser();
    if (!user) return;
    await new Promise<void>((resolve) => user.signOut(() => resolve())).catch(() => {});
    user.signOut();
  }

  private async validSession(): Promise<CognitoUserSession> {
    const user: CognitoUser | null = (await this.pool()).getCurrentUser();
    if (!user) throw new AdminAuthError('sessionExpired');
    return new Promise((resolve, reject) =>
      user.getSession((err: Error | null, session: CognitoUserSession | null) =>
        err || !session?.isValid() ? reject(err ?? new AdminAuthError('sessionExpired')) : resolve(session),
      ),
    );
  }
}

function toSession(session: CognitoUserSession): AdminSession {
  return { username: String(session.getIdToken().decodePayload()['cognito:username'] ?? '') };
}

function mapError(err: { code?: string; name?: string; message?: string }): AdminAuthError {
  const code = err?.code ?? err?.name;
  if (code === 'NotAuthorizedException' && /attempts exceeded/i.test(err.message ?? '')) {
    return new AdminAuthError('tooMany');
  }
  switch (code) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
    case 'InvalidParameterException':
      return new AdminAuthError('credentials');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
    case 'TooManyFailedAttemptsException':
      return new AdminAuthError('tooMany');
    case 'NetworkError':
      return new AdminAuthError('network');
    default:
      return new AdminAuthError(err instanceof TypeError ? 'network' : 'generic');
  }
}
