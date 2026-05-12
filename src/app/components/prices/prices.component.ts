import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './prices.component.html',
  styleUrl: './prices.component.scss',
})
export class PricesComponent {
  protected readonly t = inject(TranslationService).t;
}
