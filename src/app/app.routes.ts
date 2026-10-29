import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'schueler',
    loadComponent: () => import('./student/student-area.component').then((m) => m.StudentAreaComponent),
  },
  { path: '**', redirectTo: '' },
];
