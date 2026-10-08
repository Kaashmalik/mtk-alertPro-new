/**
 * COCO SSD class ID → app detection type (shared by detectionService + tests)
 */

export type CocoDetectionType = 'person' | 'vehicle' | 'animal';

export const COCO_DETECTION_CLASSES: Record<number, CocoDetectionType> = {
  0: 'person',
  1: 'person',
  2: 'vehicle',
  3: 'vehicle',
  5: 'vehicle',
  6: 'vehicle',
  7: 'vehicle',
  8: 'vehicle',
  14: 'animal', // bird
  15: 'animal', // cat
  16: 'animal', // dog
  17: 'animal', // horse
  18: 'animal', // sheep
  19: 'animal', // cow
  20: 'animal', // elephant
  21: 'animal', // bear
  22: 'animal', // zebra
  23: 'animal', // giraffe
};

export function mapCocoClassToDetectionType(
  classId: number,
): CocoDetectionType | null {
  return COCO_DETECTION_CLASSES[classId] ?? null;
}
