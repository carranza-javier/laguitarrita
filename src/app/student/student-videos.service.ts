import { Injectable, inject } from '@angular/core';
import { StudentAuthError, StudentAuthService } from './student-auth.service';
import { STUDENT_CONFIG } from './student-config';

export type FileType = 'video' | 'audio' | 'pdf';

export interface VideoDto {
  name: string;
  /** Videos and audio files play in the player dialog, PDFs open in the browser's viewer. */
  type: FileType;
  /** Recording date (from the video's metadata) or, if unknown, the upload date. */
  date: string;
  size: number;
  playUrl: string;
  downloadUrl: string;
  /** The student's own note for this video ('' if none). */
  note: string;
}

export interface VideoList {
  videos: VideoDto[];
  /** Lifetime of the presigned URLs in seconds. */
  expiresIn: number;
}

export class VideosLoadError extends Error {}

export const MAX_NOTE_LENGTH = 5000;

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

  /** Saves the student's note for one of their videos; an empty text deletes it. */
  async saveNote(video: string, text: string): Promise<void> {
    const token = await this.auth.accessToken();
    let res: Response;
    try {
      res = await fetch(`${STUDENT_CONFIG.apiUrl}/notes`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ video, text }),
      });
    } catch {
      throw new StudentAuthError('network');
    }
    if (res.status === 401) throw new StudentAuthError('sessionExpired');
    if (!res.ok) throw new VideosLoadError(`HTTP ${res.status}`);
  }
}
