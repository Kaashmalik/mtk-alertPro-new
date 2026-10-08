import {
  MATCH_THRESHOLD,
  cosineSimilarity,
  matchEmbedding,
  normalizeEmbedding,
} from '@/features/faces';
import { FACE_EMBEDDING_DIM, useFaceStore } from '@/features/faces/faceStore';

describe('normalizeEmbedding', () => {
  it('produces a unit-length vector', () => {
    const v = normalizeEmbedding([3, 4]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });

  it('is safe on the zero vector', () => {
    const v = normalizeEmbedding([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and -1 for opposites', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is 0 for mismatched or empty vectors', () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('matchEmbedding', () => {
  beforeEach(() => {
    useFaceStore.setState({ profiles: [], isHydrated: true });
  });

  it('returns null when no one is enrolled', () => {
    expect(matchEmbedding(new Array(FACE_EMBEDDING_DIM).fill(0.1))).toBeNull();
  });

  it('returns the enrolled person above the threshold', async () => {
    const embedding = new Array(FACE_EMBEDDING_DIM).fill(0.01);
    embedding[0] = 1;
    const normalized = normalizeEmbedding(embedding);
    await useFaceStore.getState().enroll('Alice', normalized);

    const noisy = [...normalized];
    noisy[0] += 0.05;
    const match = matchEmbedding(normalizeEmbedding(noisy));
    expect(match?.name).toBe('Alice');
    expect(match!.similarity).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('rejects a dissimilar face', async () => {
    const a = new Array(FACE_EMBEDDING_DIM).fill(0);
    a[0] = 1;
    await useFaceStore.getState().enroll('Alice', normalizeEmbedding(a));

    const b = new Array(FACE_EMBEDDING_DIM).fill(0);
    b[64] = 1;
    expect(matchEmbedding(normalizeEmbedding(b))).toBeNull();
  });
});

describe('faceStore.enroll validation', () => {
  beforeEach(() => {
    useFaceStore.setState({ profiles: [], isHydrated: true });
  });

  it('rejects the wrong embedding dimension', async () => {
    await useFaceStore.getState().enroll('Bob', [1, 2, 3]);
    expect(useFaceStore.getState().profiles).toHaveLength(0);
  });

  it('trims and stores a valid enrollment', async () => {
    await useFaceStore
      .getState()
      .enroll('  Bob  ', new Array(FACE_EMBEDDING_DIM).fill(0.5));
    expect(useFaceStore.getState().profiles[0].name).toBe('Bob');
  });
});
