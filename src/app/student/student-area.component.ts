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
  viewChildren,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from '../services/translation.service';
import { AuthErrorCode, StudentAuthError, StudentAuthService, StudentSession } from './student-auth.service';
import { StudentVideosService, VideoDto } from './student-videos.service';

type View = 'checking' | 'login' | 'videos';
type ErrorKey = AuthErrorCode | 'missing' | 'videos';

interface VideoItem {
  name: string;
  title: string;
  date: Date;
  size: number;
  playUrl: WritableSignal<string>;
  downloadUrl: WritableSignal<string>;
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
  protected email = '';
  protected password = '';

  private readonly players = viewChildren<ElementRef<HTMLVideoElement>>('player');
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
    if (!this.email.trim() || !this.password) return this.error.set('missing');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.session.set(await this.auth.login(this.email, this.password));
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
    await this.auth.logout();
    this.session.set(null);
    this.videos.set(null);
    this.error.set(null);
    this.view.set('login');
  }

  protected async loadVideos(): Promise<void> {
    this.error.set(null);
    this.videos.set(null);
    try {
      const { videos } = await this.fetchList();
      this.videos.set(videos.map(toItem));
    } catch (err) {
      this.handleError(err);
    }
  }

  /** The presigned URL may have expired (e.g. the tab stayed open): get new ones and resume. */
  protected async onPlayerError(item: VideoItem, player: HTMLVideoElement): Promise<void> {
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

  protected formatDate(date: Date): string {
    return date.toLocaleDateString(this.ts.lang() === 'de' ? 'de-CH' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  protected formatSize(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

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
   * Swaps in new presigned URLs without interrupting playback: players that are playing keep
   * their current URL (they get a new one through onPlayerError if it stops working).
   * `force` names a video whose player must get the new URL regardless.
   */
  private refreshUrls(force?: string): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const { videos } = await this.fetchList();
        const fresh = new Map(videos.map((v) => [v.name, v]));
        const busy = new Set(
          this.players()
            .map((p) => p.nativeElement)
            .filter((el) => !el.paused && !el.error)
            .map((el) => el.dataset['name']),
        );
        for (const item of this.videos() ?? []) {
          const dto = fresh.get(item.name);
          if (!dto) continue;
          item.downloadUrl.set(dto.downloadUrl);
          if (item.name === force || !busy.has(item.name)) item.playUrl.set(dto.playUrl);
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
    title: v.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(),
    date: new Date(v.lastModified),
    size: v.size,
    playUrl: signal(v.playUrl),
    downloadUrl: signal(v.downloadUrl),
  };
}
