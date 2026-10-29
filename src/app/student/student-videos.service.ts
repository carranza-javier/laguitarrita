import { Injectable, inject } from '@angular/core';
import { StudentAuthError, StudentAuthService } from './student-auth.service';
import { STUDENT_CONFIG } from './student-config';

export interface VideoDto {
  name: string;
  lastModified: string;
  size: number;
  playUrl: string;
  downloadUrl: string;
}

export interface VideoList {
  videos: VideoDto[];
  /** Lifetime of the presigned URLs in seconds. */
  expiresIn: number;
}

export class VideosLoadError extends Error {}

@Injectable({ providedIn: 'root' })
export class StudentVideosService {
  private readonly auth = inject(StudentAuthService);

  /** Lists the signed-in student's videos with fresh presigned URLs. */
  async list(): Promise<VideoList> {
    const token = await this.auth.accessToken();
    let res: Response;
    try {
      res = await fetch(`${STUDENT_CONFIG.apiUrl}/videos`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch {
      throw new StudentAuthError('network');
    }
    if (res.status === 401) throw new StudentAuthError('sessionExpired');
    if (!res.ok) throw new VideosLoadError(`HTTP ${res.status}`);
    return res.json();
  }
}
