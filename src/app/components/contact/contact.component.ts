import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
})
export class ContactComponent {
  protected readonly t = inject(TranslationService).t;
}
