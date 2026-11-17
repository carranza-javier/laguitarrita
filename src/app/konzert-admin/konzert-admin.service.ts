import { inject, Injectable } from '@angular/core';
import { KONZERT_ADMIN_CONFIG } from './konzert-admin-config';
import { AdminAuthError, KonzertAdminAuthService } from './konzert-admin-auth.service';

export interface AdminTicket {
  id: string;
  name: string;
  tickets: number;
  status: 'active' | 'cancelled';
  paid: boolean;
  arrived: boolean;
  reference: string;
  createdAt: string | null;
}

export interface AdminTotals {
  capacity: number;
  price: number;
  currency: string;
  sold: number;
  remaining: number;
  paidSeats: number;
  unpaidSeats: number;
  arrivedSeats: number;
  expectedTotal: number;
}

export interface AdminList {
  tickets: AdminTicket[];
  totals: AdminTotals;
}

export type AdminApiErrorCode = 'sessionExpired' | 'network' | 'capacity' | 'validation' | 'generic';

export class AdminApiError extends Error {
  constructor(
    readonly code: AdminApiErrorCode,
    readonly remaining?: number,
  ) {
    super(code);
  }
}

@Injectable({ providedIn: 'root' })
export class KonzertAdminService {
  private readonly auth = inject(KonzertAdminAuthService);

  list(): Promise<AdminList> {
    return this.request('GET', '/admin/tickets');
  }

  create(name: string, tickets: number, paid: boolean): Promise<AdminTicket> {
    return this.request('POST', '/admin/tickets', { name, tickets, paid });
  }

  setFlags(id: string, flags: { paid?: boolean; arrived?: boolean }): Promise<AdminTicket> {
    return this.request('PATCH', `/admin/tickets/${encodeURIComponent(id)}`, flags);
  }

  cancel(id: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/admin/tickets/${encodeURIComponent(id)}/cancel`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.auth.accessToken(); // throws AdminAuthError('sessionExpired')
    let res: Response;
    try {
      res = await fetch(`${KONZERT_ADMIN_CONFIG.apiUrl}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          authorization: token,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AdminApiError('network');
    }
    if (res.ok) return res.json();
    if (res.status === 401) throw new AdminApiError('sessionExpired');
    if (res.status === 409) {
      const b = await res.json().catch(() => ({}));
      throw new AdminApiError('capacity', b.remaining);
    }
    if (res.status === 400) throw new AdminApiError('validation');
    throw new AdminApiError('generic');
  }
}

/** Maps an auth-layer error (e.g. the token could not be refreshed) onto the API error codes. */
export function toApiError(err: unknown): AdminApiError {
  if (err instanceof AdminApiError) return err;
  if (err instanceof AdminAuthError) {
    return new AdminApiError(err.code === 'network' ? 'network' : 'sessionExpired');
  }
  return new AdminApiError('generic');
}
