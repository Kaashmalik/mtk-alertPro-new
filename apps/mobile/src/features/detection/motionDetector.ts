/**
 * Frame-diff motion detector (CPU-light free-tier / always-on path)
 */

import * as FileSystem from 'expo-file-system/legacy';

export interface MotionResult {
  motion: boolean;
  score: number; // 0-1
}

/**
 * Compare two JPEG files by sampling decoded base64 length + byte variance heuristic.
 * Full pixel decode isn't available without a native image decoder; we use a
 * lightweight base64 sample diff that still reacts to scene changes.
 */
export async function detectMotionBetweenFrames(
  prevPath: string | null,
  nextPath: string,
  threshold = 0.08
): Promise<MotionResult> {
  if (!prevPath) {
    return { motion: false, score: 0 };
  }

  try {
    const [a, b] = await Promise.all([
      FileSystem.readAsStringAsync(prevPath, {
        encoding: FileSystem.EncodingType.Base64,
      }),
      FileSystem.readAsStringAsync(nextPath, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    ]);

    // Sample every Nth char for speed
    const step = 64;
    const len = Math.min(a.length, b.length);
    let diff = 0;
    let samples = 0;
    for (let i = 0; i < len; i += step) {
      samples++;
      if (a.charCodeAt(i) !== b.charCodeAt(i)) diff++;
    }

    // Size delta also indicates motion (new JPEG entropy)
    const sizeDelta =
      Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1);

    const score = Math.min(1, diff / Math.max(samples, 1) * 0.7 + sizeDelta * 0.3);
    return { motion: score >= threshold, score };
  } catch {
    return { motion: false, score: 0 };
  }
}
