/**
 * Face Recognition Service
 *
 * Turns a JPEG snapshot into a 128-d embedding using a TFJS GraphModel and
 * matches it against enrolled known people with cosine similarity.
 *
 * The model contract: 112x112 RGB input, normalized to [-1, 1], returns a
 * single embedding vector (any length — we L2-normalize and use the model's
 * own dimension). The URL is provided via EXPO_PUBLIC_FACE_MODEL_URL; the
 * service fails closed (`isConfigured() === false`) when it is absent so the
 * feature degrades to "not available" instead of silently misidentifying.
 *
 * @module features/faces/faceRecognitionService
 */
import * as tf from '@tensorflow/tfjs';
import { Platform } from 'react-native';

let decodeJpeg: ((data: Uint8Array, channels?: number) => tf.Tensor3D) | null =
  null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    decodeJpeg = require('@tensorflow/tfjs-react-native').decodeJpeg;
  } catch {
    console.log('[FaceRecognition] tfjs-react-native not available');
  }
}

import { FACE_EMBEDDING_DIM, useFaceStore } from './faceStore';

/** Cosine similarity above which two embeddings are treated as the same person. */
export const MATCH_THRESHOLD = 0.6;

const INPUT_SIZE = 112;

let model: tf.GraphModel | null = null;
let loadPromise: Promise<tf.GraphModel | null> | null = null;

export function isConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_FACE_MODEL_URL);
}

async function ensureLoaded(): Promise<tf.GraphModel | null> {
  if (model) return model;
  if (!isConfigured()) return null;
  if (!loadPromise) {
    const url = process.env.EXPO_PUBLIC_FACE_MODEL_URL as string;
    loadPromise = tf
      .loadGraphModel(url)
      .then((m) => {
        model = m;
        return m;
      })
      .catch((error) => {
        console.warn('[FaceRecognition] model load failed:', error);
        loadPromise = null;
        return null;
      });
  }
  return loadPromise;
}

/** L2-normalize so cosine similarity reduces to a dot product. */
export function normalizeEmbedding(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Embed a JPEG file path into a normalized descriptor.
 * Returns null when the model is unavailable or the image cannot be decoded.
 */
export async function embedFromFile(path: string): Promise<number[] | null> {
  const m = await ensureLoaded();
  if (!m || !decodeJpeg) return null;

  try {
    const file = await fetch(
      path.startsWith('file://') ? path : `file://${path}`,
    );
    const buffer = await file.arrayBuffer();
    const tensor = decodeJpeg(new Uint8Array(buffer), 3);
    try {
      const resized = tf.image.resizeBilinear(tensor as tf.Tensor3D, [
        INPUT_SIZE,
        INPUT_SIZE,
      ]);
      const batched = resized
        .expandDims(0)
        .div(tf.scalar(127.5))
        .sub(tf.scalar(1)) as tf.Tensor4D;
      const output = m.predict(batched) as tf.Tensor;
      try {
        const data = await output.data();
        if (data.length !== FACE_EMBEDDING_DIM) {
          console.warn(
            `[FaceRecognition] embedding dim ${data.length} != ${FACE_EMBEDDING_DIM}`,
          );
          return null;
        }
        return normalizeEmbedding(Array.from(data));
      } finally {
        output.dispose();
        batched.dispose();
      }
    } finally {
      tensor.dispose();
    }
  } catch (error) {
    console.warn('[FaceRecognition] embed failed:', error);
    return null;
  }
}

export interface FaceMatch {
  personId: string;
  name: string;
  similarity: number;
}

/** Match an embedding against enrolled known people. Null when no match. */
export function matchEmbedding(embedding: number[]): FaceMatch | null {
  const { profiles } = useFaceStore.getState();
  let best: FaceMatch | null = null;
  for (const p of profiles) {
    const sim = cosineSimilarity(embedding, p.embedding);
    if (sim >= MATCH_THRESHOLD && (!best || sim > best.similarity)) {
      best = { personId: p.id, name: p.name, similarity: sim };
    }
  }
  return best;
}

/** Full path: snapshot file → matched known person (or null). */
export async function identifyFromFile(
  path: string,
): Promise<FaceMatch | null> {
  const embedding = await embedFromFile(path);
  if (!embedding) return null;
  return matchEmbedding(embedding);
}
