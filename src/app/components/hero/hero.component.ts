import { Component, AfterViewInit, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
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
export class HeroComponent implements AfterViewInit, OnDestroy {
  @ViewChild('heroVideo') videoRef!: ElementRef<HTMLVideoElement>;

  protected readonly t = inject(TranslationService).t;
  protected readonly muted = signal(true);
  protected readonly showHint = signal(true);
  protected readonly hintFading = signal(false);
  protected readonly videoReady = signal(false);

  private readonly hintFadeTimer = setTimeout(() => this.hintFading.set(true), 5000);
  private readonly hintTimer = setTimeout(() => this.showHint.set(false), 7000);

  ngAfterViewInit(): void {
    const video = this.videoRef?.nativeElement;
    if (video) {
      video.muted = true;
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.hintFadeTimer);
    clearTimeout(this.hintTimer);
  }

  onVideoReady(): void {
    this.videoReady.set(true);
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
