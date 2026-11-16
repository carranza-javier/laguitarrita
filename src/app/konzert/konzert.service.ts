import { Injectable } from '@angular/core';
import { KONZERT_CONFIG } from './konzert-config';

export interface Availability {
  remaining: number;
  capacity: number;
  price: number;
  currency: string;
  soldOut: boolean;
}

export interface TicketConfirmation {
  id: string;
  name: string;
  tickets: number;
  amount: number;
  currency: string;
  reference: string;
}

export type KonzertErrorCode = 'capacity' | 'validation' | 'network' | 'generic';

export class KonzertError extends Error {
  constructor(
    readonly code: KonzertErrorCode,
    readonly remaining?: number,
  ) {
    super(code);
  }
}

@Injectable({ providedIn: 'root' })
export class KonzertService {
  /** GET /availability: how many tickets are still free (plus capacity and price). */
  async availability(): Promise<Availability> {
    let res: Response;
    try {
      res = await fetch(`${KONZERT_CONFIG.apiUrl}/availability`, { cache: 'no-store' });
    } catch {
      throw new KonzertError('network');
    }
    if (!res.ok) throw new KonzertError('generic');
    return res.json();
  }

  /**
   * POST /tickets: records an active ticket (it counts towards the capacity at once) and returns the
   * payment reference. `honeypot` is the hidden anti-spam field and must stay empty.
   */
  async buy(name: string, tickets: number, honeypot: string): Promise<TicketConfirmation> {
    let res: Response;
    try {
      res = await fetch(`${KONZERT_CONFIG.apiUrl}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, tickets, website: honeypot }),
      });
    } catch {
      throw new KonzertError('network');
    }
    if (res.status === 201) return res.json();
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      throw new KonzertError('capacity', body.remaining);
    }
    if (res.status === 400) throw new KonzertError('validation');
    throw new KonzertError('generic');
  }
}
