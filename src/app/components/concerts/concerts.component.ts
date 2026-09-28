import { Component, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-concerts',
  standalone: true,
  templateUrl: './concerts.component.html',
  styleUrl: './concerts.component.scss',
})
export class ConcertsComponent {
  protected readonly t = inject(TranslationService).t;
}
