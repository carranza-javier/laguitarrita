import { Injectable } from '@angular/core';
import type { CognitoUser, CognitoUserPool, CognitoUserSession } from 'amazon-cognito-identity-js';
import { STUDENT_CONFIG } from './student-config';

export type AuthErrorCode = 'credentials' | 'tooMany' | 'network' | 'sessionExpired' | 'generic';

export class StudentAuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

export interface StudentSession {
  username: string;
}

/**
 * Cognito sign-in (SRP, the password never leaves the browser) for the student area.
 * Tokens live in sessionStorage: they survive reloads but are gone when the tab closes.
 * Only used in the browser; the Cognito library is loaded lazily with the student area.
 */
@Injectable({ providedIn: 'root' })
export class StudentAuthService {
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
          UserPoolId: STUDENT_CONFIG.userPoolId,
          ClientId: STUDENT_CONFIG.userPoolClientId,
          Storage: window.sessionStorage,
        }),
    );
    return this.poolPromise;
  }

  /** Returns a valid (refreshed if needed) session, or null if the student is not signed in. */
  async currentSession(): Promise<StudentSession | null> {
    const session = await this.validSession().catch(() => null);
    return session ? toStudentSession(session) : null;
  }

  async login(name: string, password: string): Promise<StudentSession> {
    const { AuthenticationDetails, CognitoUser } = await this.lib();
    const pool = await this.pool();
    const username = name.trim().toLowerCase();
    const user = new CognitoUser({ Username: username, Pool: pool, Storage: window.sessionStorage });
    const session = await new Promise<CognitoUserSession>((resolve, reject) =>
      user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
        onSuccess: resolve,
        onFailure: (err) => reject(mapError(err)),
        // Students get permanent passwords, so Cognito should never ask for a new one.
        newPasswordRequired: () => reject(new StudentAuthError('generic')),
      }),
    );
    return toStudentSession(session);
  }

  /** Access token for the API; throws StudentAuthError('sessionExpired') if it cannot be refreshed. */
  async accessToken(): Promise<string> {
    try {
      return (await this.validSession()).getAccessToken().getJwtToken();
    } catch {
      throw new StudentAuthError('sessionExpired');
    }
  }

  async logout(): Promise<void> {
    const user = (await this.pool()).getCurrentUser();
    if (!user) return;
    // signOut() also revokes the refresh token at Cognito; clear locally even if that fails.
    await new Promise<void>((resolve) => user.signOut(() => resolve())).catch(() => {});
    user.signOut();
  }

  private async validSession(): Promise<CognitoUserSession> {
    const user: CognitoUser | null = (await this.pool()).getCurrentUser();
    if (!user) throw new StudentAuthError('sessionExpired');
    return new Promise((resolve, reject) =>
      user.getSession((err: Error | null, session: CognitoUserSession | null) =>
        err || !session?.isValid() ? reject(err ?? new StudentAuthError('sessionExpired')) : resolve(session),
      ),
    );
  }
}

function toStudentSession(session: CognitoUserSession): StudentSession {
  return { username: String(session.getIdToken().decodePayload()['cognito:username'] ?? '') };
}

function mapError(err: { code?: string; name?: string; message?: string }): StudentAuthError {
  const code = err?.code ?? err?.name;
  if (code === 'NotAuthorizedException' && /attempts exceeded/i.test(err.message ?? '')) {
    return new StudentAuthError('tooMany');
  }
  switch (code) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
    case 'InvalidParameterException':
      return new StudentAuthError('credentials');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
    case 'TooManyFailedAttemptsException':
      return new StudentAuthError('tooMany');
    case 'NetworkError':
      return new StudentAuthError('network');
    default:
      console.error(err);
      return new StudentAuthError(err instanceof TypeError ? 'network' : 'generic');
  }
}
