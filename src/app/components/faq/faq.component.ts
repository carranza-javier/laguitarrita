import { Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss',
})
export class FaqComponent {
  protected readonly t = inject(TranslationService).t;
  protected readonly openIndex = signal<number | null>(null);

  toggle(i: number): void {
    this.openIndex.update(current => (current === i ? null : i));
  }
}
