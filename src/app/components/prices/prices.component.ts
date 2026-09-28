import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslationService } from '../../services/translation.service';

/**
 * Launch pricing: regular prices shown struck through next to the current ones.
 * To end the launch period, set this to `null` — the struck-through prices,
 * the "Startpreis" label and the screen-reader hints all disappear.
 */
const LAUNCH_OLD_PRICES: Record<string, string> | null = {
  single: 'CHF 80',
  inPerson: 'CHF 280',
  online: 'CHF 240',
};

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './prices.component.html',
  styleUrl: './prices.component.scss',
})
export class PricesComponent {
  protected readonly t = inject(TranslationService).t;
  protected readonly oldPrices = LAUNCH_OLD_PRICES;
}
