import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-classes',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './classes.component.html',
  styleUrl: './classes.component.scss',
})
export class ClassesComponent {
  protected readonly t = inject(TranslationService).t;
}
