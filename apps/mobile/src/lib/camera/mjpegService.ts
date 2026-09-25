/**
 * MJPEG / HTTP snapshot stream service
 * Polls JPEG snapshot endpoints (or derives them from an MJPEG URL)
 * and exposes frames as data URIs for <Image /> rendering.
 * No native modules — plain fetch + polling (works in Expo Go).
 *
 * @module lib/camera/mjpegService
 */

import { parseHttpStreamUrl } from './protocol';

export type MjpegStatus = 'idle' | 'loading' | 'live' | 'error';

export interface MjpegFrame {
  /** data:image/jpeg;base64,... URI ready for <Image source={{ uri }} /> */
  uri: string;
  timestamp: number;
}

export interface MjpegStreamOptions {
  /** Camera stream URL (MJPEG multipart URL or direct snapshot JPEG URL) */
  url: string;
  /** Frames per second (default 2 = every 500ms) */
  fps?: number;
  /** Per-frame request timeout in ms (default 4000) */
  timeoutMs?: number;
  /** Optional basic-auth credentials */
  username?: string;
  password?: string;
}

export interface MjpegStreamState {
  status: MjpegStatus;
  frame: MjpegFrame | null;
  error?: string;
}

const DEFAULT_FPS = 2;
const DEFAULT_TIMEOUT_MS = 4000;
const MIN_INTERVAL_MS = 250;

/**
 * Common snapshot endpoint paths keyed off a stream's origin/path
 */
const SNAPSHOT_PATH_TEMPLATES = [
  '/snapshot.jpg',
  '/cgi-bin/snapshot.cgi',
  '/cgi-bin/jpg/image.cgi',
  '/ISAPI/Streaming/channels/101/picture',
  '/onvif-http/snapshot',
  '/image.jpg',
  '/jpg/image.jpg',
  '/video.mjpg',
  '/videostream.cgi',
];

/**
 * Build origin for derived candidates, preserving any user:pass@ userinfo
 * so auth cameras keep working on sibling snapshot paths.
 */
function buildOrigin(parsed: NonNullable<ReturnType<typeof parseHttpStreamUrl>>): string {
  const userinfo =
    parsed.username !== undefined
      ? `${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password || '')}@`
      : '';
  // Omit default ports so derived URLs match the original form
  const isDefaultPort =
    (parsed.protocol === 'http:' && parsed.port === 80) ||
    (parsed.protocol === 'https:' && parsed.port === 443);
  const portPart = isDefaultPort ? '' : `:${parsed.port}`;
  return `${parsed.protocol}//${userinfo}${parsed.hostname}${portPart}`;
}

/**
 * Build an ordered list of candidate frame URLs from a camera stream URL.
 * The original URL is first (many "MJPEG" URLs actually return a single JPEG
 * per request, or the URL is already a snapshot endpoint).
 */
export function getSnapshotCandidates(url: string): string[] {
  const candidates: string[] = [url];
  const parsed = parseHttpStreamUrl(url);
  if (!parsed) return candidates;

  const origin = buildOrigin(parsed);
  const lowerPath = parsed.path.toLowerCase();
  // path + query (query matters for many MJPEG endpoints)
  const pathWithSearch = parsed.search || parsed.path;

  // If the path already looks like a known stream/snapshot leaf, try siblings
  const baseDir = parsed.path.replace(/\/[^/]*$/, '') || '';

  for (const template of SNAPSHOT_PATH_TEMPLATES) {
    candidates.push(`${origin}${template}`);
    if (baseDir && baseDir !== '/') {
      candidates.push(`${origin}${baseDir}${template}`);
    }
  }

  // Query-string variants commonly used with MJPEG endpoints
  if (pathWithSearch) {
    const sep = pathWithSearch.includes('?') ? '&' : '?';
    candidates.push(`${origin}${pathWithSearch}${sep}frame=1`);
    if (lowerPath.includes('mjpg') || lowerPath.includes('mjpeg') || lowerPath.includes('videostream')) {
      candidates.push(`${origin}/snapshot.jpg`);
    }
  }

  // Dedupe while preserving order
  return [...new Set(candidates)];
}

/**
 * Convert a Blob to a data:image/jpeg;base64 URI via FileReader
 */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader not available'));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image data'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * UTF-8–safe Base64 (btoa throws on non-Latin1; Hermes may lack btoa edge cases).
 */
function toBase64(value: string): string {
  if (typeof btoa === 'function') {
    try {
      return btoa(unescape(encodeURIComponent(value)));
    } catch {
      // fall through to manual encoder
    }
  }
  const bytes = new Uint8Array(
    Array.from(value).flatMap(ch => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x80) return [code];
      if (code < 0x800) return [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
      if (code < 0x10000) return [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
      return [
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      ];
    })
  );
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : chars[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : chars[b2 & 63];
  }
  return out;
}

function buildAuthHeaders(username?: string, password?: string): Record<string, string> {
  if (!username) return {};
  return { Authorization: `Basic ${toBase64(`${username}:${password || ''}`)}` };
}

/**
 * Extract the first complete JPEG (SOI..EOI) from a blob that may contain
 * multipart MIME framing or extra bytes around a JPEG payload.
 */
async function extractFirstJpeg(blob: Blob): Promise<Blob | null> {
  if (blob.size < 4) return null;
  // Cap scan to 2MB — a single MJPEG frame never exceeds this in practice
  const scanBlob = blob.size > 2 * 1024 * 1024 ? blob.slice(0, 2 * 1024 * 1024) : blob;
  const buf = await scanBlob.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let start = -1;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = -1;
  for (let i = start + 2; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      end = i + 2;
      break;
    }
  }
  // Endless multipart stream: EOI may not have arrived yet — no complete frame
  if (end < 0) return null;

  return blob.slice(start, end, 'image/jpeg');
}

/**
 * Fetch a single JPEG frame from a URL and return a data URI.
 * Handles both single-JPEG responses and multipart MJPEG bodies by
 * extracting the first SOI..EOI frame. Returns null for non-images.
 */
export async function fetchSnapshotFrame(
  url: string,
  options: { timeoutMs?: number; username?: string; password?: string } = {}
): Promise<string | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, username, password } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'image/*, */*',
      ...buildAuthHeaders(username, password),
    };

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();

    // HTML / JSON error pages are not frames
    if (
      contentType.includes('text/html') ||
      contentType.includes('application/json') ||
      contentType.includes('text/plain')
    ) {
      return null;
    }

    const isMultipart = contentType.includes('multipart');
    const isJpegType = contentType.includes('image/jpeg') || contentType.includes('image/jpg');
    const isImageType = contentType.startsWith('image/') || isMultipart;

    // Prefer image/* content types; also accept octet-stream / unknown if body is JPEG
    const blob = await response.blob();
    if (blob.size === 0) return null;

    // Multipart / ambiguous bodies: pull the first complete JPEG out of the stream
    if (isMultipart || !isJpegType) {
      if (isImageType || contentType.includes('octet-stream') || !contentType) {
        const extracted = await extractFirstJpeg(blob);
        if (!extracted) return null;
        return await blobToDataUri(extracted);
      }
      return null;
    }

    return await blobToDataUri(blob);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the first working snapshot URL from the candidate list.
 * Probes candidates once (HEAD-ish GET cancelled after headers where possible).
 */
export async function resolveFrameUrl(
  url: string,
  options: { timeoutMs?: number; username?: string; password?: string } = {}
): Promise<string | null> {
  const candidates = getSnapshotCandidates(url);

  for (const candidate of candidates) {
    const frame = await fetchSnapshotFrame(candidate, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 3000),
    });
    if (frame) return candidate;
  }

  return null;
}

/**
 * Polling MJPEG/snapshot stream client.
 *
 * Usage:
 * ```ts
 * const stream = createMjpegStream({ url: camera.rtspUrl, fps: 2 });
 * stream.start();
 * // stream.getState() → { status, frame }
 * stream.stop();
 * ```
 */
export interface MjpegStream {
  start(): void;
  stop(): void;
  restart(): void;
  getState(): MjpegStreamState;
  subscribe(listener: (state: MjpegStreamState) => void): () => void;
}

export function createMjpegStream(options: MjpegStreamOptions): MjpegStream {
  const { url, password } = options;
  // Fallback to credentials embedded in the URL (user:pass@host) when props omit them
  const parsedUrlCreds = parseHttpStreamUrl(url);
  const username = options.username ?? parsedUrlCreds?.username;
  const pass = password ?? parsedUrlCreds?.password;
  const fps = options.fps && options.fps > 0 ? options.fps : DEFAULT_FPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = Math.max(MIN_INTERVAL_MS, Math.round(1000 / fps));

  let state: MjpegStreamState = { status: 'idle', frame: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let generation = 0;
  let frameUrl: string | null = null;
  const listeners = new Set<(s: MjpegStreamState) => void>();

  const setState = (next: MjpegStreamState) => {
    state = next;
    listeners.forEach(listener => listener(state));
  };

  const tick = async (gen: number) => {
    if (!running || gen !== generation) return;

    try {
      if (!frameUrl) {
        frameUrl = await resolveFrameUrl(url, { timeoutMs, username, password: pass });
      }

      if (!running || gen !== generation) return;

      if (!frameUrl) {
        setState({
          status: 'error',
          frame: state.frame,
          error: 'No snapshot endpoint responded. Check the stream URL.',
        });
      } else {
        const uri = await fetchSnapshotFrame(frameUrl, { timeoutMs, username, password: pass });
        if (!running || gen !== generation) return;

        if (uri) {
          setState({ status: 'live', frame: { uri, timestamp: Date.now() } });
        } else {
          // Frame fetch failed — force re-resolve next tick
          frameUrl = null;
          setState({
            status: state.frame ? 'live' : 'loading',
            frame: state.frame,
            error: state.frame ? undefined : 'Waiting for first frame…',
          });
        }
      }
    } catch {
      if (running && gen === generation) {
        setState({
          status: state.frame ? 'live' : 'error',
          frame: state.frame,
          error: 'Stream error',
        });
      }
    }

    if (running && gen === generation) {
      timer = setTimeout(() => tick(gen), intervalMs);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      setState({ status: 'loading', frame: null });
      tick(generation);
    },
    stop() {
      running = false;
      generation += 1;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      setState({ status: 'idle', frame: state.frame });
    },
    restart() {
      this.stop();
      frameUrl = null;
      this.start();
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
