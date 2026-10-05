import { Component, ElementRef, OnDestroy, ViewChild, afterNextRender, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.scss',
})
export class HeroComponent implements OnDestroy {
  @ViewChild('heroVideo') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('heroContent') contentRef!: ElementRef<HTMLElement>;

  protected readonly t = inject(TranslationService).t;
  protected readonly muted = signal(true);
  protected readonly showHint = signal(true);
  protected readonly hintFading = signal(false);
  protected readonly showVideo = signal(false);

  private readonly hintFadeTimer = setTimeout(() => this.hintFading.set(true), 5000);
  private readonly hintTimer = setTimeout(() => this.showHint.set(false), 7000);

  constructor() {
    // With hydration the prerendered intro animation may already be running (or even
    // finished) before Angular boots, so wait on the animation itself rather than on
    // an animationend event that could have fired before the listener existed.
    afterNextRender(() => {
      const video = this.videoRef?.nativeElement;
      if (video) video.muted = true;
      const animations = this.contentRef?.nativeElement.getAnimations?.() ?? [];
      Promise.all(animations.map(a => a.finished))
        .catch(() => {})
        .then(() => this.startVideo());
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.hintFadeTimer);
    clearTimeout(this.hintTimer);
  }

  private startVideo(): void {
    const video = this.videoRef?.nativeElement;
    if (!video || this.showVideo()) return;
    video.play().catch(() => {});
    this.showVideo.set(true);
  }

  toggleMute(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    const newMuted = !this.muted();
    this.muted.set(newMuted);
    video.muted = newMuted;
  }

  scrollToAbout(): void {
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
  }
}
