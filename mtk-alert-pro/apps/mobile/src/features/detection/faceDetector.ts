/**
 * Simple on-device face heuristic upgrade:
 * Upper-body person crop is treated as face only when person confidence is high.
 * Hook point for ML Kit / BlazeFace in a future native build.
 */

import type { DetectionResult } from '@/types';

export function deriveFaceDetections(
  detections: DetectionResult[],
  minPersonScore = 0.7
): DetectionResult[] {
  const faces: DetectionResult[] = [];

  for (const d of detections) {
    if (d.type !== 'person' || d.confidence < minPersonScore || !d.boundingBox) {
      continue;
    }
    const box = d.boundingBox;
    faces.push({
      type: 'face',
      confidence: Math.min(0.95, d.confidence * 0.92),
      boundingBox: {
        x: box.x + box.width * 0.2,
        y: box.y,
        width: box.width * 0.6,
        height: box.height * 0.35,
      },
    });
  }

  return faces;
}
