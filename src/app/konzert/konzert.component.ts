import { Component, DestroyRef, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from '../services/translation.service';
import { KONZERT_CONFIG, MAX_TICKETS } from './konzert-config';
import { Availability, KonzertError, KonzertErrorCode, KonzertService, TicketConfirmation } from './konzert.service';

const HOME_TITLE = 'Gitarrenunterricht in Bern – Flamenco & spanische Gitarre';
const HOME_URL = 'https://laguitarrita.ch/';
const STORAGE_KEY = 'konzert-ticket-v1';
const JSONLD_ID = 'konzert-event-jsonld';

type FormError = KonzertErrorCode | 'name';

@Component({
  selector: 'app-konzert',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './konzert.component.html',
  styleUrl: './konzert.component.scss',
})
export class KonzertComponent {
  protected readonly ts = inject(TranslationService);
  protected readonly t = computed(() => this.ts.t().konzert);
  private readonly service = inject(KonzertService);
  private readonly doc = inject(DOCUMENT);

  protected readonly availability = signal<Availability | null>(null);
  protected readonly availError = signal(false);
  protected readonly confirmation = signal<TicketConfirmation | null>(null);
  protected readonly submitting = signal(false);
  protected readonly formError = signal<FormError | null>(null);
  protected readonly copied = signal<'number' | 'text' | null>(null);

  protected name = '';
  protected tickets = 1;
  protected honeypot = '';

  /** The TWINT number lives only in the contact section; shown as-is, copied without spaces. */
  protected readonly twintNumber = computed(() => this.ts.t().contact.phone);
  protected readonly twintCopyValue = computed(() => this.twintNumber().replace(/\s+/g, ''));

  protected readonly price = computed(() => this.availability()?.price ?? KONZERT_CONFIG.priceChf);
  protected readonly soldOut = computed(() => this.availability()?.soldOut ?? false);

  /** 1…min(4, remaining): never offer more tickets than are left once availability is known. */
  protected readonly ticketOptions = computed(() => {
    const remaining = this.availability()?.remaining;
    const max = remaining == null ? MAX_TICKETS : Math.min(MAX_TICKETS, remaining);
    return Array.from({ length: Math.max(0, max) }, (_, i) => i + 1);
  });

  private copyTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.setUpHead();
    afterNextRender(() => {
      this.restore();
      this.loadAvailability();
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copyTimer));
  }

  protected async loadAvailability(): Promise<void> {
    this.availError.set(false);
    try {
      this.availability.set(await this.service.availability());
      // Keep the chosen amount within what is still available.
      const max = this.ticketOptions().length;
      if (max && this.tickets > max) this.tickets = max;
    } catch {
      this.availError.set(true);
    }
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.name.trim()) {
      this.formError.set('name');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    try {
      const confirmation = await this.service.buy(this.name.trim(), this.tickets, this.honeypot);
      this.confirmation.set(confirmation);
      this.persist(confirmation);
      this.loadAvailability();
      scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const code: FormError = err instanceof KonzertError ? err.code : 'generic';
      this.formError.set(code);
      if (code === 'capacity') this.loadAvailability();
    } finally {
      this.submitting.set(false);
    }
  }

  protected async copy(kind: 'number' | 'text', value: string): Promise<void> {
    if (!(await this.writeClipboard(value))) return; // value stays on screen to copy by hand
    this.copied.set(kind);
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copied.set(null), 2000);
  }

  /** Copies text, preferring the async Clipboard API and falling back to a hidden textarea. */
  private async writeClipboard(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fall through to the legacy path (blocked promise, insecure context, …).
    }
    try {
      const ta = this.doc.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      this.doc.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = this.doc.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  protected buyAnother(): void {
    this.confirmation.set(null);
    this.formError.set(null);
    this.name = '';
    this.tickets = 1;
    this.clearPersisted();
    this.loadAvailability();
  }

  /** Fills {name}, {n}, {cap} placeholders in a translation string. */
  protected fill(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
  }

  // ---------------------------------------------------------------- persistence (browser only)

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.confirmation.set(JSON.parse(raw));
    } catch {}
  }

  private persist(confirmation: TicketConfirmation): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmation));
    } catch {}
  }

  private clearPersisted(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------- SEO head

  /**
   * /konzert is a public, indexable page: it gets its own title and description, a canonical that
   * points at itself (replacing the home canonical baked into index.html) and Event structured data.
   * On destroy — i.e. navigating back to the one-pager — the home head is restored.
   */
  private setUpHead(): void {
    const meta = inject(Meta);
    const title = inject(Title);
    const canonical = this.ensureCanonical();

    effect(() => {
      const k = this.t();
      title.setTitle(k.pageTitle);
      meta.updateTag({ name: 'description', content: k.metaDescription });
      canonical.href = KONZERT_CONFIG.url;
    });
    this.injectEventJsonLd();

    inject(DestroyRef).onDestroy(() => {
      title.setTitle(HOME_TITLE);
      canonical.href = HOME_URL;
      this.doc.getElementById(JSONLD_ID)?.remove();
    });
  }

  private ensureCanonical(): HTMLLinkElement {
    let link = this.doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.rel = 'canonical';
      this.doc.head.appendChild(link);
    }
    return link;
  }

  private injectEventJsonLd(): void {
    this.doc.getElementById(JSONLD_ID)?.remove();
    const loc = KONZERT_CONFIG.location;
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Hauskonzert – Flamenco mit Javier Carranza',
      startDate: KONZERT_CONFIG.startIso,
      doorTime: KONZERT_CONFIG.doorsIso,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      image: 'https://laguitarrita.ch/assets/javier.jpg',
      location: {
        '@type': 'Place',
        name: loc.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: loc.street,
          postalCode: loc.postalCode,
          addressLocality: loc.city,
          addressCountry: loc.country,
        },
      },
      performer: { '@type': 'Person', name: 'Javier Carranza' },
      organizer: { '@type': 'Person', name: 'Javier Carranza', url: HOME_URL },
      offers: {
        '@type': 'Offer',
        price: String(KONZERT_CONFIG.priceChf),
        priceCurrency: 'CHF',
        url: KONZERT_CONFIG.url,
        availability: 'https://schema.org/InStock',
      },
    };
    const script = this.doc.createElement('script');
    script.id = JSONLD_ID;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    this.doc.head.appendChild(script);
  }
}
