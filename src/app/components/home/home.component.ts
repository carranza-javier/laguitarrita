import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../navbar/navbar.component';
import { HeroComponent } from '../hero/hero.component';
import { AboutComponent } from '../about/about.component';
import { ClassesComponent } from '../classes/classes.component';
import { ConcertsComponent } from '../concerts/concerts.component';
import { PricesComponent } from '../prices/prices.component';
import { FaqComponent } from '../faq/faq.component';
import { ContactComponent } from '../contact/contact.component';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RouterLink,
    NavbarComponent,
    HeroComponent,
    AboutComponent,
    ClassesComponent,
    ConcertsComponent,
    PricesComponent,
    FaqComponent,
    ContactComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  protected readonly t = inject(TranslationService).t;
}
