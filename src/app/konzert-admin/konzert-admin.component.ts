import { Component, DestroyRef, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from '../services/translation.service';
import { AdminAuthError, AdminSession, KonzertAdminAuthService } from './konzert-admin-auth.service';
import { AdminTicket, AdminTotals, KonzertAdminService, toApiError } from './konzert-admin.service';

type View = 'checking' | 'login' | 'list';
const HOME_TITLE = 'Gitarrenunterricht in Bern – Flamenco & spanische Gitarre';
const HOME_URL = 'https://laguitarrita.ch/';

@Component({
  selector: 'app-konzert-admin',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './konzert-admin.component.html',
  styleUrl: './konzert-admin.component.scss',
})
export class KonzertAdminComponent {
  protected readonly ts = inject(TranslationService);
  protected readonly t = computed(() => this.ts.t().konzertAdmin);
  private readonly auth = inject(KonzertAdminAuthService);
  private readonly apiService = inject(KonzertAdminService);
  private readonly doc = inject(DOCUMENT);

  protected readonly view = signal<View>('checking');
  protected readonly session = signal<AdminSession | null>(null);

  // Login form.
  protected username = '';
  protected password = '';
  protected readonly showPassword = signal(false);
  protected readonly loginBusy = signal(false);
  protected readonly loginError = signal<string | null>(null);

  // List state.
  protected readonly tickets = signal<AdminTicket[]>([]);
  protected readonly totals = signal<AdminTotals | null>(null);
  protected readonly listError = signal<string | null>(null);

  protected readonly showCancelled = signal(false);
  protected readonly busyIds = signal<Set<string>>(new Set());
  protected readonly confirmingCancel = signal<string | null>(null);
  protected readonly confirmingDelete = signal<string | null>(null);

  // Manual entry form.
  protected readonly manualOpen = signal(false);
  protected manualName = '';
  protected manualTickets = 1;
  protected manualPaid = false;
  protected readonly manualBusy = signal(false);
  protected readonly manualError = signal<string | null>(null);

  protected readonly price = computed(() => this.totals()?.price ?? 15);
  protected readonly capacity = computed(() => this.totals()?.capacity ?? null);

  /** Active unpaid first, then active paid, then cancelled; each group oldest first. */
  protected readonly visible = computed(() => {
    let list = this.tickets();
    if (!this.showCancelled()) list = list.filter((t) => t.status === 'active');
    return [...list].sort((a, b) => sortKey(a) - sortKey(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  });

  protected readonly cancelledCount = computed(() => this.tickets().filter((t) => t.status !== 'active').length);

  /** Active tickets sorted alphabetically — the printable door list. */
  protected readonly printRows = computed(() =>
    this.tickets()
      .filter((t) => t.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name, this.ts.lang())),
  );

  constructor() {
    this.setUpHead();
    afterNextRender(() => {
      this.restoreSession();
      // The list refreshes whenever the tab becomes visible again — no button, no timer.
      this.doc.addEventListener('visibilitychange', this.onVisible);
    });
    inject(DestroyRef).onDestroy(() => {
      if (typeof document !== 'undefined') this.doc.removeEventListener('visibilitychange', this.onVisible);
    });
  }

  private readonly onVisible = () => {
    if (this.doc.visibilityState === 'visible' && this.view() === 'list') this.loadList().catch(() => {});
  };

  // ---------------------------------------------------------------- auth
  private async restoreSession(): Promise<void> {
    try {
      const session = await this.auth.currentSession();
      this.session.set(session);
      this.view.set(session ? 'list' : 'login');
      if (session) await this.loadList();
    } catch {
      this.view.set('login');
    }
  }

  protected async login(): Promise<void> {
    if (this.loginBusy()) return;
    if (!this.username.trim() || !this.password) return this.loginError.set(this.t().login.missing);
    this.loginBusy.set(true);
    this.loginError.set(null);
    try {
      this.session.set(await this.auth.login(this.username, this.password));
      this.password = '';
      this.view.set('list');
      await this.loadList();
    } catch (err) {
      const code = err instanceof AdminAuthError ? err.code : 'generic';
      this.loginError.set(this.t().login.errors[code]);
    } finally {
      this.loginBusy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.session.set(null);
    this.tickets.set([]);
    this.totals.set(null);
    this.manualOpen.set(false);
    this.listError.set(null);
    this.view.set('login');
  }

  // ---------------------------------------------------------------- list
  protected async loadList(): Promise<void> {
    this.listError.set(null);
    try {
      const data = await this.apiService.list();
      this.tickets.set(data.tickets);
      this.totals.set(data.totals);
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): void {
    const e = toApiError(err);
    if (e.code === 'sessionExpired') {
      this.session.set(null);
      this.view.set('login');
      this.loginError.set(this.t().sessionExpired);
    } else {
      this.listError.set(this.t().listError);
    }
  }

  // ---------------------------------------------------------------- row actions
  protected isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  private setBusy(id: string, busy: boolean): void {
    const next = new Set(this.busyIds());
    if (busy) next.add(id);
    else next.delete(id);
    this.busyIds.set(next);
  }

  protected async togglePaid(t: AdminTicket): Promise<void> {
    await this.mutate(t.id, () => this.apiService.setPaid(t.id, !t.paid));
  }

  protected askCancel(id: string): void {
    this.confirmingCancel.set(id);
  }

  protected dismissCancel(): void {
    this.confirmingCancel.set(null);
  }

  protected async confirmCancel(t: AdminTicket): Promise<void> {
    this.confirmingCancel.set(null);
    await this.mutate(t.id, () => this.apiService.cancel(t.id));
  }

  // Permanent delete, only offered for already-cancelled tickets (shown via "show cancelled").
  protected askDelete(id: string): void {
    this.confirmingDelete.set(id);
  }

  protected dismissDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected async confirmDelete(t: AdminTicket): Promise<void> {
    this.confirmingDelete.set(null);
    await this.mutate(t.id, () => this.apiService.remove(t.id));
  }

  protected deleteText(t: AdminTicket): string {
    return fill(this.t().confirmDelete, { name: t.name });
  }

  /** Runs a mutating call, shows a per-row spinner, then reloads so the counter stays exact. */
  private async mutate(id: string, action: () => Promise<unknown>): Promise<void> {
    if (this.isBusy(id)) return;
    this.setBusy(id, true);
    this.listError.set(null);
    try {
      await action();
      await this.loadList();
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'sessionExpired') this.handleError(e);
      else this.listError.set(this.t().actionError);
    } finally {
      this.setBusy(id, false);
    }
  }

  // ---------------------------------------------------------------- manual entry
  protected openManual(): void {
    this.manualName = '';
    this.manualTickets = 1;
    this.manualPaid = false;
    this.manualError.set(null);
    this.manualOpen.set(true);
  }

  protected closeManual(): void {
    this.manualOpen.set(false);
  }

  protected async submitManual(): Promise<void> {
    if (this.manualBusy()) return;
    const m = this.t().manual;
    if (!this.manualName.trim()) return this.manualError.set(m.errorName);
    const n = Number(this.manualTickets);
    const cap = this.capacity();
    if (!Number.isInteger(n) || n < 1 || (cap != null && n > cap)) return this.manualError.set(m.errorTickets);
    this.manualBusy.set(true);
    this.manualError.set(null);
    try {
      await this.apiService.create(this.manualName.trim(), n, this.manualPaid);
      await this.loadList();
      this.manualOpen.set(false);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'capacity') this.manualError.set(fill(m.errorCapacity, { n: e.remaining ?? 0 }));
      else if (e.code === 'sessionExpired') {
        this.manualOpen.set(false);
        this.handleError(e);
      } else this.manualError.set(m.errorGeneric);
    } finally {
      this.manualBusy.set(false);
    }
  }

  // ---------------------------------------------------------------- print
  protected print(): void {
    if (typeof window !== 'undefined') window.print();
  }

  // ---------------------------------------------------------------- formatting
  protected amount(t: AdminTicket): number {
    return t.tickets * this.price();
  }

  protected ticketsLabel(t: AdminTicket): string {
    const k = this.t();
    return `${t.tickets} ${t.tickets === 1 ? k.ticketsOne : k.ticketsOther}`;
  }

  protected confirmText(t: AdminTicket): string {
    return fill(this.t().confirm, { name: t.name });
  }

  /** "vor 1 Std." / "1 hr ago" from the ticket's creation time, localised. */
  protected age(createdAt: string | null): string {
    if (!createdAt) return '';
    const a = this.t().age;
    const ms = Date.now() - Date.parse(createdAt);
    if (!Number.isFinite(ms) || ms < 0) return a.now;
    const min = Math.floor(ms / 60000);
    if (min < 1) return a.now;
    if (min < 60) return fill(a.min, { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return fill(h === 1 ? a.hour : a.hours, { n: h });
    const d = Math.floor(h / 24);
    return fill(d === 1 ? a.day : a.days, { n: d });
  }

  // ---------------------------------------------------------------- head (noindex)
  private setUpHead(): void {
    const meta = inject(Meta);
    const title = inject(Title);
    this.doc.querySelector('link[rel="canonical"]')?.remove();
    meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    effect(() => title.setTitle(this.t().pageTitle));
    inject(DestroyRef).onDestroy(() => {
      meta.removeTag('name="robots"');
      title.setTitle(HOME_TITLE);
      const canonical = this.doc.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = HOME_URL;
      this.doc.head.appendChild(canonical);
    });
  }
}

/** Sort weight: active-unpaid (0), active-paid (1), cancelled (2). */
function sortKey(t: AdminTicket): number {
  if (t.status !== 'active') return 2;
  return t.paid ? 1 : 0;
}

/** Replaces {name} / {n} placeholders in a translation string. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
