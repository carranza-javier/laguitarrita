import {
  Component,
  DestroyRef,
  ElementRef,
  WritableSignal,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from '../services/translation.service';
import { AuthErrorCode, StudentAuthError, StudentAuthService, StudentSession } from './student-auth.service';
import { FileType, MAX_NOTE_LENGTH, StudentVideosService, VideoDto } from './student-videos.service';

type View = 'checking' | 'login' | 'videos';
type ErrorKey = AuthErrorCode | 'missing' | 'videos';

interface VideoItem {
  name: string;
  type: FileType;
  title: string;
  date: Date;
  size: number;
  playUrl: WritableSignal<string>;
  downloadUrl: WritableSignal<string>;
  note: WritableSignal<string>;
}

interface MonthGroup {
  key: string;
  label: string;
  items: VideoItem[];
}

const HOME_TITLE = 'Gitarrenunterricht in Bern – Flamenco & spanische Gitarre';
const HOME_URL = 'https://laguitarrita.ch/';

/** Refresh presigned URLs this long before they actually expire. */
const URL_SAFETY_MARGIN_MS = 5 * 60 * 1000;
/** Do not retry a failed video more often than this (avoids reload loops). */
const MIN_RETRY_INTERVAL_MS = 15 * 1000;

@Component({
  selector: 'app-student-area',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './student-area.component.html',
  styleUrl: './student-area.component.scss',
})
export class StudentAreaComponent {
  protected readonly ts = inject(TranslationService);
  protected readonly t = computed(() => this.ts.t().student);
  private readonly auth = inject(StudentAuthService);
  private readonly videosApi = inject(StudentVideosService);

  protected readonly view = signal<View>('checking');
  protected readonly session = signal<StudentSession | null>(null);
  protected readonly videos = signal<VideoItem[] | null>(null);
  protected readonly error = signal<ErrorKey | null>(null);
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected username = '';
  protected password = '';

  // Library: search and month groups (newest first, only the newest month open by default).
  protected readonly query = signal('');
  private readonly openMonths = signal(new Set<string>());
  private readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const all = this.videos() ?? [];
    return q ? all.filter((v) => normalize(v.title).includes(q)) : all;
  });
  protected readonly groups = computed(() => groupByMonth(this.filtered(), this.locale()));

  // Player dialog.
  protected readonly speeds = [0.5, 0.6, 0.75, 0.9, 1];
  protected readonly speed = signal(1);
  protected readonly playing = signal<VideoItem | null>(null);
  private readonly playerDialog = viewChild<ElementRef<HTMLDialogElement>>('playerDialog');
  private readonly player = viewChild<ElementRef<HTMLMediaElement>>('player');

  // Notes dialog.
  protected readonly maxNoteLength = MAX_NOTE_LENGTH;
  protected readonly editing = signal<VideoItem | null>(null);
  protected readonly noteSaving = signal(false);
  protected readonly noteError = signal(false);
  protected noteDraft = '';
  private readonly noteDialog = viewChild<ElementRef<HTMLDialogElement>>('noteDialog');

  private urlsValidUntil = 0;
  private lastRefresh = 0;
  private refreshing?: Promise<void>;

  constructor() {
    this.setUpHead();
    afterNextRender(() => this.restoreSession());

    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.view() === 'videos' && this.urlsStale()) {
        this.refreshUrls().catch(() => {});
      }
    };
    afterNextRender(() => document.addEventListener('visibilitychange', onVisible));
    inject(DestroyRef).onDestroy(() => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (!this.username.trim() || !this.password) return this.error.set('missing');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.session.set(await this.auth.login(this.username, this.password));
      this.password = '';
      this.view.set('videos');
      await this.loadVideos();
    } catch (err) {
      if (!(err instanceof StudentAuthError)) console.error(err);
      this.error.set(err instanceof StudentAuthError ? err.code : 'generic');
    } finally {
      this.busy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    this.playerDialog()?.nativeElement.close();
    this.noteDialog()?.nativeElement.close();
    await this.auth.logout();
    this.session.set(null);
    this.videos.set(null);
    this.query.set('');
    this.error.set(null);
    this.view.set('login');
  }

  protected async loadVideos(): Promise<void> {
    this.error.set(null);
    this.videos.set(null);
    try {
      const { videos } = await this.fetchList();
      const items = videos.map(toItem);
      this.videos.set(items);
      this.openMonths.set(new Set(items.length ? [monthKey(items[0].date)] : []));
    } catch (err) {
      this.handleError(err);
    }
  }

  protected isOpen(group: MonthGroup): boolean {
    // While searching, every month with results is shown open.
    return !!this.query().trim() || this.openMonths().has(group.key);
  }

  protected toggleMonth(group: MonthGroup): void {
    const open = new Set(this.openMonths());
    if (open.has(group.key)) open.delete(group.key);
    else open.add(group.key);
    this.openMonths.set(open);
  }

  // ---------------------------------------------------------------- player

  /** Main action of a row: play videos and audio files, open PDFs in the browser's viewer. */
  protected open(event: MouseEvent, item: VideoItem): void {
    if (item.type === 'pdf') this.openPdf(event, item);
    else this.play(item);
  }

  /**
   * Opens a PDF in a new tab. A still valid link is simply followed; otherwise the tab is opened
   * right away (so it is not blocked as a pop-up) and pointed at a fresh URL once there is one.
   */
  protected async openPdf(event: MouseEvent, item: VideoItem): Promise<void> {
    const isLink = event.currentTarget instanceof HTMLAnchorElement;
    if (!this.urlsStale()) {
      if (!isLink) window.open(item.playUrl(), '_blank', 'noopener');
      return;
    }
    event.preventDefault();
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      await this.refreshUrls();
      if (tab) tab.location.href = item.playUrl();
      else window.location.assign(item.playUrl());
    } catch {
      tab?.close();
    }
  }

  protected async play(item: VideoItem): Promise<void> {
    if (this.urlsStale()) {
      try {
        await this.refreshUrls();
      } catch {
        return;
      }
    }
    // Reopened before the previous player was removed from the page: start it over.
    const previous = this.player()?.nativeElement;
    if (previous && this.playing() === item) {
      previous.currentTime = 0;
      previous.play().catch(() => {});
    }
    this.playing.set(item);
    this.playerDialog()?.nativeElement.showModal();
  }

  protected closePlayer(): void {
    this.playerDialog()?.nativeElement.close();
  }

  /**
   * Space toggles play/pause, as in any video player. The dialog opens with focus on a button, so
   * Space would otherwise activate that control; we override it everywhere except on the media
   * element itself, which already toggles on Space (handling it here too would cancel out).
   */
  protected onPlayerKeydown(event: KeyboardEvent): void {
    if (event.code !== 'Space' && event.key !== ' ') return;
    const player = this.player()?.nativeElement;
    if (!player || event.target === player) return;
    event.preventDefault();
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  }

  /** Called on every close (button, Esc or backdrop): removing the video element stops the download. */
  protected onPlayerClosed(): void {
    // The close event is asynchronous: ignore it if another video was opened in the meantime.
    if (this.playerDialog()?.nativeElement.open) return;
    this.player()?.nativeElement.pause();
    this.playing.set(null);
  }

  protected setSpeed(speed: number): void {
    this.speed.set(speed);
    const player = this.player()?.nativeElement;
    if (player) player.playbackRate = speed;
  }

  /** A new src resets the playback rate, so the chosen speed is applied again. */
  protected onPlayerLoaded(player: HTMLMediaElement): void {
    player.playbackRate = this.speed();
  }

  /** The presigned URL may have expired (e.g. the dialog stayed open): get a new one and resume. */
  protected async onPlayerError(item: VideoItem, player: HTMLMediaElement): Promise<void> {
    if (Date.now() - this.lastRefresh < MIN_RETRY_INTERVAL_MS) return;
    const resumeAt = player.currentTime;
    try {
      await this.refreshUrls(item.name);
    } catch {
      return;
    }
    if (resumeAt > 0) {
      player.addEventListener('loadedmetadata', () => (player.currentTime = resumeAt), { once: true });
    }
  }

  protected async download(event: MouseEvent, item: VideoItem): Promise<void> {
    if (!this.urlsStale()) return; // the link's href is still valid: let the browser follow it
    event.preventDefault();
    try {
      await this.refreshUrls();
      window.location.assign(item.downloadUrl());
    } catch {}
  }

  // ---------------------------------------------------------------- notes

  protected openNote(item: VideoItem): void {
    this.editing.set(item);
    this.noteDraft = item.note();
    this.noteError.set(false);
    this.noteDialog()?.nativeElement.showModal();
  }

  protected closeNote(): void {
    this.noteDialog()?.nativeElement.close();
  }

  protected async saveNote(): Promise<void> {
    const item = this.editing();
    if (!item || this.noteSaving()) return;
    const text = this.noteDraft.trim() ? this.noteDraft : '';
    this.noteSaving.set(true);
    this.noteError.set(false);
    try {
      await this.videosApi.saveNote(item.name, text);
      item.note.set(text);
      this.closeNote();
    } catch (err) {
      if (err instanceof StudentAuthError && err.code === 'sessionExpired') {
        this.closeNote();
        this.handleError(err);
      } else {
        this.noteError.set(true);
      }
    } finally {
      this.noteSaving.set(false);
    }
  }

  /** Closes a dialog when its backdrop (the dialog element itself, outside the panel) is clicked. */
  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target === dialog) dialog.close();
  }

  // ---------------------------------------------------------------- formatting

  /** Short date for a row: the month group already shows month and year. */
  protected formatDate(date: Date): string {
    return date.toLocaleDateString(this.locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  }

  protected formatSize(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
  }

  protected formatSpeed(speed: number): string {
    return `${speed.toLocaleString(this.locale())}×`;
  }

  /** "3 Videos · 1 Audio · 2 PDFs" */
  protected countLabel(items: VideoItem[]): string {
    const words = this.t().count;
    return (['video', 'audio', 'pdf'] as const)
      .map((type) => [type, items.filter((i) => i.type === type).length] as const)
      .filter(([, n]) => n > 0)
      .map(([type, n]) => `${n} ${words[type][n === 1 ? 0 : 1]}`)
      .join(' · ');
  }

  private locale(): string {
    return this.ts.lang() === 'de' ? 'de-CH' : 'en-GB';
  }

  // ---------------------------------------------------------------- data

  private async restoreSession(): Promise<void> {
    const session = await this.auth.currentSession();
    this.session.set(session);
    this.view.set(session ? 'videos' : 'login');
    if (session) await this.loadVideos();
  }

  private async fetchList() {
    const list = await this.videosApi.list();
    this.lastRefresh = Date.now();
    this.urlsValidUntil = this.lastRefresh + list.expiresIn * 1000 - URL_SAFETY_MARGIN_MS;
    return list;
  }

  private urlsStale(): boolean {
    return Date.now() >= this.urlsValidUntil;
  }

  /**
   * Swaps in new presigned URLs without interrupting playback: the video that is playing keeps
   * its current URL (it gets a new one through onPlayerError if it stops working).
   * `force` names a video whose player must get the new URL regardless.
   */
  private refreshUrls(force?: string): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const { videos } = await this.fetchList();
        const fresh = new Map(videos.map((v) => [v.name, v]));
        const player = this.player()?.nativeElement;
        const busy = player && !player.paused && !player.error ? this.playing()?.name : undefined;
        for (const item of this.videos() ?? []) {
          const dto = fresh.get(item.name);
          if (!dto) continue;
          item.downloadUrl.set(dto.downloadUrl);
          if (item.name === force || item.name !== busy) item.playUrl.set(dto.playUrl);
        }
      } catch (err) {
        this.handleError(err);
        throw err;
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  private handleError(err: unknown): void {
    if (err instanceof StudentAuthError && err.code === 'sessionExpired') {
      this.playerDialog()?.nativeElement.close();
      this.session.set(null);
      this.videos.set(null);
      this.view.set('login');
      this.error.set('sessionExpired');
    } else {
      this.error.set(err instanceof StudentAuthError ? err.code : 'videos');
    }
  }

  /**
   * noindex, no canonical pointing at the home page, own title. Leaving the student area always
   * goes to the home page, so its head (as in src/index.html) is restored on destroy, even when
   * the visit started on the prerendered /schueler page that never had it.
   */
  private setUpHead(): void {
    const meta = inject(Meta);
    const title = inject(Title);
    const doc = inject(DOCUMENT);
    doc.querySelector('link[rel="canonical"]')?.remove();
    meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    effect(() => title.setTitle(this.t().pageTitle));
    inject(DestroyRef).onDestroy(() => {
      meta.removeTag('name="robots"');
      title.setTitle(HOME_TITLE);
      const canonical = doc.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = HOME_URL;
      doc.head.appendChild(canonical);
    });
  }
}

function toItem(v: VideoDto): VideoItem {
  return {
    name: v.name,
    type: v.type ?? 'video',
    // The title is the file name exactly as uploaded, without the extension.
    title: v.name.replace(/\.[^.]+$/, ''),
    date: new Date(v.date),
    size: v.size,
    playUrl: signal(v.playUrl),
    downloadUrl: signal(v.downloadUrl),
    note: signal(v.note ?? ''),
  };
}

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/** Case- and accent-insensitive form for searching ("Bulerias" finds "Bulerías"). */
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Groups videos (already sorted newest first) by calendar month. */
function groupByMonth(items: VideoItem[], locale: string): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const item of items) {
    const key = monthKey(item.date);
    let group = groups.get(key);
    if (!group) {
      const label = item.date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
