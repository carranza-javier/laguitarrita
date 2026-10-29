import { Component, afterNextRender, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    const router = inject(Router);
    // public/404.html stores the requested path before sending GitHub Pages visitors to "/".
    afterNextRender(() => {
      let redirect: string | null = null;
      try {
        redirect = sessionStorage.getItem('redirect');
        sessionStorage.removeItem('redirect');
      } catch {}
      if (redirect && redirect !== '/') router.navigateByUrl(redirect);
    });
  }
}
