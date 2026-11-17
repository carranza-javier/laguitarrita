import {
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AdminAuthError, AdminSession, KonzertAdminAuthService } from './konzert-admin-auth.service';
import {
  AdminApiError,
  AdminList,
  AdminTicket,
  AdminTotals,
  KonzertAdminService,
  toApiError,
} from './konzert-admin.service';

type View = 'checking' | 'login' | 'list';
const HOME_TITLE = 'Gitarrenunterricht in Bern – Flamenco & spanische Gitarre';
const HOME_URL = 'https://laguitarrita.ch/';
const CACHE_KEY = 'konzert-admin-cache-v1';
const REFRESH_MS = 60_000;

interface Cache {
  tickets: AdminTicket[];
  totals: AdminTotals;
  at: string;
}

@Component({
  selector: 'app-konzert-admin',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './konzert-admin.component.html',
  styleUrl: './konzert-admin.component.scss',
})
export class KonzertAdminComponent {
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
  protected readonly lastUpdated = signal<Date | null>(null);
  protected readonly online = signal(true);
  protected readonly loading = signal(false);
  protected readonly listError = signal<string | null>(null);

  protected readonly query = signal('');
  protected readonly showCancelled = signal(false);
  protected readonly busyIds = signal<Set<string>>(new Set());
  protected readonly confirmingCancel = signal<string | null>(null);

  // Manual entry form.
  protected readonly manualOpen = signal(false);
  protected manualName = '';
  protected manualTickets = 1;
  protected manualPaid = false;
  protected readonly manualBusy = signal(false);
  protected readonly manualError = signal<string | null>(null);

  protected readonly price = computed(() => this.totals()?.price ?? 15);
  protected readonly capacity = computed(() => this.totals()?.capacity ?? null);

  /** Active unpaid first, then active paid, then cancelled; each group oldest first. Name search applied. */
  protected readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    let list = this.tickets();
    if (!this.showCancelled()) list = list.filter((t) => t.status === 'active');
    if (q) list = list.filter((t) => normalize(t.name).includes(q));
    return [...list].sort((a, b) => sortKey(a) - sortKey(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  });

  protected readonly cancelledCount = computed(() => this.tickets().filter((t) => t.status !== 'active').length);

  /** Active tickets sorted alphabetically — the printable door list. */
  protected readonly printRows = computed(() =>
    this.tickets()
      .filter((t) => t.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  );

  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.setUpHead();
    afterNextRender(() => {
      this.restoreCache();
      this.restoreSession();
      this.refreshTimer = setInterval(() => this.autoRefresh(), REFRESH_MS);
      this.doc.addEventListener('visibilitychange', this.onVisible);
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.refreshTimer);
      if (typeof document !== 'undefined') this.doc.removeEventListener('visibilitychange', this.onVisible);
    });
  }

  private readonly onVisible = () => {
    if (this.doc.visibilityState === 'visible' && this.view() === 'list') this.autoRefresh();
  };

  private autoRefresh(): void {
    if (this.view() === 'list' && this.doc.visibilityState === 'visible') this.loadList(true).catch(() => {});
  }

  // ---------------------------------------------------------------- auth
  private async restoreSession(): Promise<void> {
    try {
      const session = await this.auth.currentSession();
      this.session.set(session);
      this.view.set(session ? 'list' : 'login');
      if (session) await this.loadList(this.tickets().length > 0);
    } catch {
      this.view.set('login');
    }
  }

  protected async login(): Promise<void> {
    if (this.loginBusy()) return;
    if (!this.username.trim() || !this.password) return this.loginError.set('Introduce usuario y contraseña.');
    this.loginBusy.set(true);
    this.loginError.set(null);
    try {
      this.session.set(await this.auth.login(this.username, this.password));
      this.password = '';
      this.view.set('list');
      await this.loadList(false);
    } catch (err) {
      this.loginError.set(loginErrorText(err));
    } finally {
      this.loginBusy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.session.set(null);
    this.tickets.set([]);
    this.totals.set(null);
    this.query.set('');
    this.manualOpen.set(false);
    this.listError.set(null);
    this.clearCache();
    this.view.set('login');
  }

  // ---------------------------------------------------------------- list
  protected async loadList(silent: boolean): Promise<void> {
    if (!silent) this.loading.set(true);
    this.listError.set(null);
    try {
      const data = await this.apiService.list();
      this.applyList(data);
      this.online.set(true);
    } catch (err) {
      this.handleLoadError(err);
    } finally {
      this.loading.set(false);
    }
  }

  private applyList(data: AdminList): void {
    this.tickets.set(data.tickets);
    this.totals.set(data.totals);
    const at = new Date();
    this.lastUpdated.set(at);
    this.saveCache({ tickets: data.tickets, totals: data.totals, at: at.toISOString() });
  }

  private handleLoadError(err: unknown): void {
    const e = toApiError(err);
    if (e.code === 'sessionExpired') {
      this.session.set(null);
      this.view.set('login');
      this.loginError.set('Tu sesión ha caducado. Vuelve a entrar.');
    } else if (e.code === 'network') {
      // Keep whatever is on screen (possibly from the cache) and block edits until we reconnect.
      this.online.set(false);
      if (!this.tickets().length) this.listError.set('Sin conexión y no hay datos guardados.');
    } else {
      this.listError.set('No se ha podido cargar la lista.');
    }
  }

  protected refresh(): void {
    this.loadList(false).catch(() => {});
  }

  // ---------------------------------------------------------------- row actions
  protected canEdit(): boolean {
    return this.online();
  }

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
    await this.mutate(t.id, () => this.apiService.setFlags(t.id, { paid: !t.paid }));
  }

  protected async toggleArrived(t: AdminTicket): Promise<void> {
    await this.mutate(t.id, () => this.apiService.setFlags(t.id, { arrived: !t.arrived }));
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

  /** Runs a mutating call, shows a per-row spinner, then silently reloads so the totals stay exact. */
  private async mutate(id: string, action: () => Promise<unknown>): Promise<void> {
    if (!this.canEdit() || this.isBusy(id)) return;
    this.setBusy(id, true);
    this.listError.set(null);
    try {
      await action();
      await this.loadList(true);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'sessionExpired') this.handleLoadError(e);
      else if (e.code === 'network') this.online.set(false);
      else this.listError.set('No se ha podido guardar el cambio.');
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
    if (!this.manualName.trim()) return this.manualError.set('Pon un nombre.');
    const n = Number(this.manualTickets);
    const cap = this.capacity();
    if (!Number.isInteger(n) || n < 1 || (cap != null && n > cap)) {
      return this.manualError.set('Número de entradas no válido.');
    }
    this.manualBusy.set(true);
    this.manualError.set(null);
    try {
      await this.apiService.create(this.manualName.trim(), n, this.manualPaid);
      await this.loadList(true);
      this.manualOpen.set(false);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'capacity') {
        this.manualError.set(`No caben: quedan ${e.remaining ?? 0} entradas.`);
      } else if (e.code === 'sessionExpired') {
        this.manualOpen.set(false);
        this.handleLoadError(e);
      } else if (e.code === 'network') {
        this.manualError.set('Sin conexión.');
      } else {
        this.manualError.set('No se ha podido crear la entrada.');
      }
    } finally {
      this.manualBusy.set(false);
    }
  }

  // ---------------------------------------------------------------- export / print
  protected exportCsv(): void {
    const header = ['Referencia', 'Nombre', 'Entradas', 'Importe (CHF)', 'Pagada', 'Llegada', 'Estado', 'Fecha'];
    const rows = [...this.tickets()]
      .sort((a, b) => sortKey(a) - sortKey(b) || String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((t) => [
        t.reference,
        t.name,
        t.tickets,
        t.tickets * this.price(),
        t.paid ? 'sí' : 'no',
        t.arrived ? 'sí' : 'no',
        t.status === 'active' ? 'activa' : 'cancelada',
        formatDateTime(t.createdAt),
      ]);
    const csv = [header, ...rows].map((cols) => cols.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = this.doc.createElement('a');
    a.href = url;
    a.download = `konzert-entradas-${new Date().toISOString().slice(0, 10)}.csv`;
    this.doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected print(): void {
    if (typeof window !== 'undefined') window.print();
  }

  // ---------------------------------------------------------------- formatting
  protected amount(t: AdminTicket): number {
    return t.tickets * this.price();
  }

  /** "hace 5 min", "hace 3 h", "hace 2 días" from the ticket's creation time. */
  protected age(createdAt: string | null): string {
    if (!createdAt) return '';
    const ms = Date.now() - Date.parse(createdAt);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  }

  protected clock(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- cache (browser only)
  private restoreCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cache = JSON.parse(raw) as Cache;
      if (cache?.tickets && cache?.totals) {
        this.tickets.set(cache.tickets);
        this.totals.set(cache.totals);
        this.lastUpdated.set(new Date(cache.at));
      }
    } catch {}
  }

  private saveCache(cache: Cache): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {}
  }

  private clearCache(): void {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------- head (noindex)
  private setUpHead(): void {
    const meta = inject(Meta);
    const title = inject(Title);
    this.doc.querySelector('link[rel="canonical"]')?.remove();
    meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    effect(() => title.setTitle('Administración · Konzert'));
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

function loginErrorText(err: unknown): string {
  const code = err instanceof AdminAuthError ? err.code : 'generic';
  switch (code) {
    case 'credentials':
      return 'Usuario o contraseña incorrectos.';
    case 'tooMany':
      return 'Demasiados intentos. Espera un momento.';
    case 'network':
      return 'Sin conexión. Inténtalo de nuevo.';
    case 'sessionExpired':
      return 'La sesión ha caducado. Vuelve a entrar.';
    default:
      return 'No se ha podido iniciar sesión.';
  }
}

const normalize = (text: string) => (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
