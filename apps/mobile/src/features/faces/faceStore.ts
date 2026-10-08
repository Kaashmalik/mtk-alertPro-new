/**
 * Known-People (face enrollment) store
 *
 * Enrolled face descriptors are the unit of identity matching. Profiles are
 * persisted in AsyncStorage so they survive reinstalls of the JS bundle, and
 * the store is the single source of truth read by the face recognition
 * service and the settings screen.
 *
 * @module features/faces/faceStore
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@mtk/known_people';
/** Hard ceiling so a runaway enrollment loop cannot grow the blob unbounded. */
const MAX_PROFILES = 50;
/** Descriptor length produced by the bundled model contract (128-d). */
export const FACE_EMBEDDING_DIM = 128;

export interface KnownPerson {
  id: string;
  name: string;
  /** L2-normalized embedding vector from the face model. */
  embedding: number[];
  createdAt: string;
  /** How many snapshots were averaged into this embedding. */
  sampleCount: number;
}

interface FaceState {
  profiles: KnownPerson[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  enroll: (name: string, embedding: number[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

function safeParse(raw: string | null): KnownPerson[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        Array.isArray(p.embedding) &&
        p.embedding.length === FACE_EMBEDDING_DIM,
    );
  } catch {
    return [];
  }
}

export const useFaceStore = create<FaceState>((set, get) => ({
  profiles: [],
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ profiles: safeParse(raw), isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  enroll: async (name, embedding) => {
    const trimmed = name.trim();
    if (!trimmed || embedding.length !== FACE_EMBEDDING_DIM) return;

    const id = `person_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const next = [
      ...get().profiles,
      {
        id,
        name: trimmed,
        embedding: [...embedding],
        createdAt: new Date().toISOString(),
        sampleCount: 1,
      },
    ].slice(-MAX_PROFILES);

    set({ profiles: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('[FaceStore] persist failed', error);
    }
  },

  remove: async (id) => {
    const next = get().profiles.filter((p) => p.id !== id);
    set({ profiles: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('[FaceStore] persist failed', error);
    }
  },

  clear: async () => {
    set({ profiles: [] });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));
