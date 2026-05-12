import { Component, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  protected readonly t = inject(TranslationService).t;
}
