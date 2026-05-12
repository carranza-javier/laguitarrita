import { Component, AfterViewInit } from '@angular/core';
import { NavbarComponent } from './components/navbar/navbar.component';
import { HeroComponent } from './components/hero/hero.component';
import { AboutComponent } from './components/about/about.component';
import { ClassesComponent } from './components/classes/classes.component';
import { PricesComponent } from './components/prices/prices.component';
import { ContactComponent } from './components/contact/contact.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NavbarComponent,
    HeroComponent,
    AboutComponent,
    ClassesComponent,
    PricesComponent,
    ContactComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements AfterViewInit {
  ngAfterViewInit(): void {
    const applyScroll = () => window.scrollTo({ top: 80, behavior: 'instant' });
    setTimeout(applyScroll, 0);
    setTimeout(applyScroll, 300);
    setTimeout(applyScroll, 800);
  }
}
