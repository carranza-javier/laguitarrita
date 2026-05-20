import { Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
  @ViewChild('heroIframe') iframeRef!: ElementRef<HTMLIFrameElement>;

  private readonly sanitizer = inject(DomSanitizer);
  protected readonly t = inject(TranslationService).t;
  protected readonly muted = signal(true);
  protected readonly showHint = signal(true);

  private readonly hintTimer = setTimeout(() => this.showHint.set(false), 6000);

  protected readonly videoUrl: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    'https://www.youtube.com/embed/izzAVi_uaIs?autoplay=1&mute=1&loop=1&playlist=izzAVi_uaIs&controls=0&rel=0&modestbranding=1&enablejsapi=1'
  );

  ngOnDestroy(): void {
    clearTimeout(this.hintTimer);
  }

  toggleMute(): void {
    const iframe = this.iframeRef?.nativeElement;
    if (!iframe) return;
    const newMuted = !this.muted();
    this.muted.set(newMuted);
    iframe.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: newMuted ? 'mute' : 'unMute', args: [] }),
      '*'
    );
  }

  scrollToAbout(): void {
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
  }
}
