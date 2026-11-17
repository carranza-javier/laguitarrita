import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'schueler',
    loadComponent: () => import('./student/student-area.component').then((m) => m.StudentAreaComponent),
  },
  {
    path: 'konzert',
    loadComponent: () => import('./konzert/konzert.component').then((m) => m.KonzertComponent),
  },
  {
    // Private admin page: no link points here, it is kept out of the prerender (see
    // prerender-routes.txt) and carries noindex,nofollow. Reloads are served by 404.html.
    path: 'konzert-admin',
    loadComponent: () => import('./konzert-admin/konzert-admin.component').then((m) => m.KonzertAdminComponent),
  },
  { path: '**', redirectTo: '' },
];
