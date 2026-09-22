/**
 * Stream protocol detection and URL parsing
 * Supports rtsp://, http(s):// MJPEG/snapshot streams, and HLS (.m3u8)
 *
 * @module lib/camera/protocol
 */

export type StreamProtocol = 'rtsp' | 'hls' | 'mjpeg' | 'http' | 'unknown';

export interface ParsedHttpStreamUrl {
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  path: string;
  /** path + query string (preserved for candidate building) */
  search: string;
  username?: string;
  password?: string;
}

const MJPEG_PATTERN = /mjpeg|mjpg|videostream|video\.mjpg|multipart\/x-mixed-replace|snapshot/i;

/**
 * Detect the stream protocol for a camera URL
 */
export function detectStreamProtocol(url: string): StreamProtocol {
  const lower = (url || '').toLowerCase().trim();
  if (!lower) return 'unknown';
  if (lower.startsWith('rtsp://')) return 'rtsp';
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    if (MJPEG_PATTERN.test(lower)) return 'mjpeg';
    return 'http';
  }
  return 'unknown';
}

/**
 * True when the URL should be played via the MJPEG/snapshot path
 * (direct HTTP camera stream, not HLS, not RTSP)
 */
export function isDirectHttpStream(url: string): boolean {
  const protocol = detectStreamProtocol(url);
  return protocol === 'mjpeg' || protocol === 'http';
}

/**
 * Parse an http(s) stream URL into components
 * Returns null for non-http URLs or invalid hosts
 */
export function parseHttpStreamUrl(url: string): ParsedHttpStreamUrl | null {
  const raw = (url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;

  try {
    // URL is available in React Native (whatwg-url polyfill)
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;

    const port =
      parsed.port
        ? parseInt(parsed.port, 10)
        : parsed.protocol === 'https:'
          ? 443
          : 80;

    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port,
      path: parsed.pathname || '/',
      search: `${parsed.pathname || '/'}${parsed.search || ''}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    return null;
  }
}
