/**
 * 🔒 MEMORY SAFE: Detection Service
 * Simplified version focused on memory safety
 */
import * as tf from '@tensorflow/tfjs';
import { Platform } from 'react-native';

let decodeJpeg: any;
if (Platform.OS !== 'web') {
  try {
    const tfjsRn = require('@tensorflow/tfjs-react-native');
    decodeJpeg = tfjsRn.decodeJpeg;
  } catch (_e) {
    console.log('[DetectionService] tfjs-react-native not available');
  }
}
import { logError } from '@/lib/utils/errorHandler';
import type { DetectionResult } from '@/types';
import NetInfo from '@react-native-community/netinfo';
import { File as ExpoFile } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import {
  COCO_DETECTION_CLASSES,
  mapCocoClassToDetectionType,
} from './cocoClasses';

export { mapCocoClassToDetectionType };

const DETECTION_CONFIG = {
  // SSD MobileNet V2 (COCO) consumes 300x300. This is only a fallback — the
  // authoritative size is read from `model.inputs[0].shape` once loaded.
  inputSize: 300,
  // MobileNet feature extractors pre-process to [-1, 1] (x / 127.5 - 1).
  // Feeding [0, 1] silently degrades accuracy, so this is explicit.
  pixelScale: 127.5,
  scoreThreshold: 0.65,
  maxDetections: 10,
  typeThresholds: {
    person: 0.6,
    vehicle: 0.65,
    animal: 0.55,
  },
} as const;

const DETECTION_CLASSES = COCO_DETECTION_CLASSES;

/**
 * Reject with `message` if `promise` has not settled within `ms`.
 *
 * The timer handle is retained and cleared once the race settles. Racing a bare
 * `new Promise((_, reject) => setTimeout(...))` left the handle armed for the
 * full duration even after the model loaded, so every successful init stranded
 * an 8s timer (and, under jest, kept the worker process alive).
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

class DetectionService {
  private model: tf.GraphModel | null = null;
  private isReady = false;
  private isProcessing = false;
  private isFallbackMode = false;
  private initPromise: Promise<void> | null = null;
  private lastProcessTime = 0;
  private netInfoUnsubscribe: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private inputSize: number = DETECTION_CONFIG.inputSize;

  /**
   * Prefer the model's own declared input shape over the hardcoded constant so
   * a mismatch can never silently degrade accuracy again.
   */
  private _syncInputSize(model: tf.GraphModel): void {
    try {
      const declared = model.inputs?.[0]?.shape;
      if (declared && declared.length === 4) {
        const [, height, width] = declared;
        if (typeof height === 'number' && height > 0 && height === width) {
          if (this.inputSize !== height) {
            console.log(
              `[DetectionService] Using model-declared input size ${height}x${height}`,
            );
          }
          this.inputSize = height;
          return;
        }
      }
    } catch {
      // Fall through to the configured default.
    }
    this.inputSize = DETECTION_CONFIG.inputSize;
  }

  async initialize(): Promise<void> {
    if (this.isReady && !this.isFallbackMode) return;
    if (this.initPromise) return this.initPromise;

    this.disposed = false;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[DetectionService] Initializing TensorFlow.js...');
      await tf.ready();

      // Try WebGL backend, fallback to CPU
      if (tf.getBackend() !== 'rn-webgl') {
        try {
          await tf.setBackend('rn-webgl');
        } catch {
          console.log('[DetectionService] Using CPU backend');
        }
      }

      // Load model with timeout and fallback
      try {
        const loadPromise = tf.loadGraphModel(
          'https://tfhub.dev/tensorflow/tfjs-model/ssd_mobilenet_v2/1/default/1',
          { fromTFHub: true },
        );
        this.model = (await withTimeout(
          loadPromise,
          8000,
          'Model loading timed out',
        )) as tf.GraphModel;
        this.isFallbackMode = false;
        this._syncInputSize(this.model);
        console.log(
          '[DetectionService] SSD MobileNet model loaded successfully',
        );
        this._stopModelRetryWatcher();
      } catch (loadError) {
        console.warn(
          '[DetectionService] Remote model load failed or offline, operating in intelligent fallback mode:',
          loadError,
        );
        this.isFallbackMode = true;
        this._startModelRetryWatcher();
      }

      this.isReady = true;
    } catch (error) {
      console.warn(
        '[DetectionService] TensorFlow initialization notice:',
        error,
      );
      logError(error, 'DetectionService.initialize');
      // Fallback enabled so app functions regardless
      this.isFallbackMode = true;
      this.isReady = true;
      this._startModelRetryWatcher();
    } finally {
      this.initPromise = null;
    }
  }

  /** True when the AI model is unavailable (offline / load failed). */
  isInFallbackMode(): boolean {
    return this.isFallbackMode;
  }

  /**
   * Attempt to load the model again (e.g. after connectivity returns).
   * Safe to call repeatedly; no-ops while a load is already in progress.
   * Resolves true when a model is available afterwards.
   */
  async retryModelLoad(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.model && !this.isFallbackMode) return true;

    if (this.initPromise) {
      await this.initPromise;
      return this.model !== null && !this.isFallbackMode;
    }

    if (!this.isReady) {
      await this.initialize();
      return this.model !== null && !this.isFallbackMode;
    }

    this.initPromise = this._retryModelLoad();
    try {
      await this.initPromise;
    } finally {
      // _retryModelLoad clears initPromise in its own finally; keep both safe
      this.initPromise = null;
    }
    return this.model !== null && !this.isFallbackMode;
  }

  private async _retryModelLoad(): Promise<void> {
    try {
      console.log('[DetectionService] Retrying model load...');
      await tf.ready();
      const loadPromise = tf.loadGraphModel(
        'https://tfhub.dev/tensorflow/tfjs-model/ssd_mobilenet_v2/1/default/1',
        { fromTFHub: true },
      );
      this.model = (await withTimeout(
        loadPromise,
        8000,
        'Model loading timed out',
      )) as tf.GraphModel;
      this.isFallbackMode = false;
      this._syncInputSize(this.model);
      console.log('[DetectionService] Model loaded successfully on retry');
      this._stopModelRetryWatcher();
    } catch (error) {
      console.warn('[DetectionService] Model retry failed:', error);
      this.isFallbackMode = true;
      this._scheduleModelRetry();
    } finally {
      this.initPromise = null;
    }
  }

  private _startModelRetryWatcher(): void {
    if (this.netInfoUnsubscribe || this.disposed) return;
    try {
      this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
        if (this.disposed || !this.isFallbackMode) return;
        const online =
          state.isConnected === true && state.isInternetReachable !== false;
        if (online && !this.initPromise) {
          void this.retryModelLoad();
        }
      });
    } catch (error) {
      console.warn(
        '[DetectionService] NetInfo unavailable for model retry:',
        error,
      );
    }
    this._scheduleModelRetry();
  }

  private _scheduleModelRetry(): void {
    if (this.retryTimer || this.disposed || !this.isFallbackMode) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isFallbackMode && !this.initPromise && !this.disposed) {
        void this.retryModelLoad();
      }
    }, 30000);
  }

  private _stopModelRetryWatcher(): void {
    if (this.netInfoUnsubscribe) {
      try {
        this.netInfoUnsubscribe();
      } catch {
        // ignore
      }
      this.netInfoUnsubscribe = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async detect(imageUri: string): Promise<DetectionResult[]> {
    if (!this.isReady) {
      console.warn('[DetectionService] Service not initialized');
      return [];
    }

    if (this.isProcessing) {
      console.log('[DetectionService] Already processing, skipping...');
      return [];
    }

    if (this.isFallbackMode || !this.model) {
      // Offline fallback: verify frame integrity without throwing
      try {
        const fileInfo = await FileSystem.getInfoAsync(imageUri);
        if (!fileInfo.exists) return [];
        return [];
      } catch {
        return [];
      }
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      // Read raw JPEG bytes. Reading via the file bytes API avoids the old
      // base64 string round-trip (~1.4x the JPEG size allocated as a JS string
      // per frame, then re-decoded). The base64 path remains as a safety net.
      const rawImage = decodeJpeg(await this._readJpegBytes(imageUri));

      const resized = tf.image.resizeBilinear(rawImage, [
        this.inputSize,
        this.inputSize,
      ]);
      rawImage.dispose();

      // MobileNet feature extractors expect [-1, 1]. A plain /255 maps into
      // [0, 1], which biases activations and measurably lowers confidence.
      const normalized = resized.div(DETECTION_CONFIG.pixelScale).sub(1);
      resized.dispose();

      const batched = normalized.expandDims(0);
      normalized.dispose();

      // Run inference
      const predictions = (await this.model.executeAsync(
        batched,
      )) as tf.Tensor[];
      batched.dispose();

      // Parse predictions
      const results = await this._parsePredictions(predictions);

      // Clean up prediction tensors
      predictions.forEach((t) => t.dispose());

      this.lastProcessTime = Date.now() - startTime;
      console.log(
        `[DetectionService] Detection completed in ${this.lastProcessTime}ms, found ${results.length} objects`,
      );

      return results;
    } catch (error) {
      console.error('[DetectionService] Detection failed:', error);
      logError(error, 'DetectionService.detect');
      return [];
    } finally {
      this.isProcessing = false;

      // 🔒 MEMORY SAFE: Cleanup any remaining tensors
      const numTensors = tf.memory().numTensors;
      if (numTensors > 0) {
        console.warn(
          `[DetectionService] Cleaning up ${numTensors} remaining tensors`,
        );
        tf.disposeVariables();
      }
    }
  }

  /** Decode a JPEG into RGBA bytes, preferring the zero-allocation file API. */
  private async _readJpegBytes(imageUri: string): Promise<Uint8Array> {
    try {
      const bytes = await new ExpoFile(imageUri).bytes();
      if (bytes instanceof Uint8Array && bytes.byteLength > 0) return bytes;
    } catch (e) {
      console.warn('[DetectionService] bytes() read failed, using base64', e);
    }

    const imageBuffer = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Pass the typed array itself — its byteOffset/length are authoritative,
    // unlike the underlying ArrayBuffer which may be a differently-sized view.
    return tf.util.encodeString(imageBuffer, 'base64');
  }

  private async _parsePredictions(
    predictions: tf.Tensor[],
  ): Promise<DetectionResult[]> {
    const [boxesTensor, classesTensor, scoresTensor, numDetectionsTensor] =
      predictions;

    const boxes = (await boxesTensor.array()) as number[][][];
    const classes = (await classesTensor.array()) as number[][];
    const scores = (await scoresTensor.array()) as number[][];
    const numDetections = await numDetectionsTensor.data();

    const results: DetectionResult[] = [];
    const count = Math.min(
      Math.round(numDetections[0]),
      DETECTION_CONFIG.maxDetections,
    );

    for (let i = 0; i < count; i++) {
      const classId = Math.round(classes[0][i]);
      const score = scores[0][i];

      if (!(classId in DETECTION_CLASSES)) continue;

      const detectionType = DETECTION_CLASSES[classId];
      const threshold =
        DETECTION_CONFIG.typeThresholds[detectionType] ||
        DETECTION_CONFIG.scoreThreshold;

      if (score < threshold) continue;

      const [y1, x1, y2, x2] = boxes[0][i];

      results.push({
        type: detectionType,
        confidence: score,
        boundingBox: {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
        },
      });
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  isInitialized(): boolean {
    return this.isReady;
  }

  isBusy(): boolean {
    return this.isProcessing;
  }

  getLastProcessTime(): number {
    return this.lastProcessTime;
  }

  async dispose(): Promise<void> {
    console.log('[DetectionService] Disposing...');

    this.disposed = true;
    this._stopModelRetryWatcher();

    if (this.model) {
      this.model.dispose();
      this.model = null;
    }

    this.isReady = false;
    this.isFallbackMode = false;
    this.initPromise = null;

    // 🔒 MEMORY SAFE: Clean up any remaining tensors
    const numTensors = tf.memory().numTensors;
    if (numTensors > 0) {
      console.log(
        `[DetectionService] Cleaning up ${numTensors} remaining tensors`,
      );
      tf.disposeVariables();
    }

    console.log('[DetectionService] Disposed');
  }
}

export const detectionService = new DetectionService();
export { DetectionService };
