export {
  useFaceStore,
  FACE_EMBEDDING_DIM,
  type KnownPerson,
} from './faceStore';
export {
  isConfigured,
  identifyFromFile,
  matchEmbedding,
  normalizeEmbedding,
  cosineSimilarity,
  embedFromFile,
  MATCH_THRESHOLD,
  type FaceMatch,
} from './faceRecognitionService';
