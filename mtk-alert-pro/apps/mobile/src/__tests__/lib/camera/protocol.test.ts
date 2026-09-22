/**
 * Stream protocol tests
 */

import {
  detectStreamProtocol,
  isDirectHttpStream,
  parseHttpStreamUrl,
} from '@/lib/camera/protocol';

describe('protocol', () => {
  describe('detectStreamProtocol', () => {
    it('detects rtsp URLs', () => {
      expect(detectStreamProtocol('rtsp://192.168.1.10:554/stream')).toBe('rtsp');
    });

    it('detects HLS URLs', () => {
      expect(detectStreamProtocol('http://192.168.1.10:8888/cam/index.m3u8')).toBe('hls');
      expect(detectStreamProtocol('https://example.com/live/stream.m3u8')).toBe('hls');
    });

    it('detects MJPEG URLs', () => {
      expect(detectStreamProtocol('http://192.168.1.10/mjpg/video.mjpg')).toBe('mjpeg');
      expect(detectStreamProtocol('http://192.168.1.10/videostream.cgi')).toBe('mjpeg');
    });

    it('detects plain HTTP URLs', () => {
      // snapshot.jpg matches the MJPEG pattern (both route to the polling player)
      expect(detectStreamProtocol('http://192.168.1.10/snapshot.jpg')).toBe('mjpeg');
      expect(detectStreamProtocol('https://camera.local/feed')).toBe('http');
    });

    it('returns unknown for empty/invalid', () => {
      expect(detectStreamProtocol('')).toBe('unknown');
      expect(detectStreamProtocol('ftp://example.com')).toBe('unknown');
    });
  });

  describe('isDirectHttpStream', () => {
    it('true for http and mjpeg', () => {
      expect(isDirectHttpStream('http://192.168.1.10/mjpg/video.mjpg')).toBe(true);
      expect(isDirectHttpStream('https://camera.local/snap')).toBe(true);
    });

    it('false for rtsp and hls', () => {
      expect(isDirectHttpStream('rtsp://192.168.1.10/stream')).toBe(false);
      expect(isDirectHttpStream('http://host/stream.m3u8')).toBe(false);
    });
  });

  describe('parseHttpStreamUrl', () => {
    it('parses host, port, path', () => {
      const parsed = parseHttpStreamUrl('http://192.168.1.50:8080/videostream.cgi');
      expect(parsed).toEqual({
        protocol: 'http:',
        hostname: '192.168.1.50',
        port: 8080,
        path: '/videostream.cgi',
        search: '/videostream.cgi',
        username: undefined,
        password: undefined,
      });
    });

    it('preserves query string in search', () => {
      const parsed = parseHttpStreamUrl('http://cam.local/videostream.cgi?channel=1&subtype=0');
      expect(parsed?.path).toBe('/videostream.cgi');
      expect(parsed?.search).toBe('/videostream.cgi?channel=1&subtype=0');
    });

    it('defaults ports by scheme', () => {
      expect(parseHttpStreamUrl('http://cam.local/x')?.port).toBe(80);
      expect(parseHttpStreamUrl('https://cam.local/x')?.port).toBe(443);
    });

    it('extracts credentials', () => {
      const parsed = parseHttpStreamUrl('http://admin:secret@192.168.1.50/snap');
      expect(parsed?.username).toBe('admin');
      expect(parsed?.password).toBe('secret');
    });

    it('rejects non-http URLs', () => {
      expect(parseHttpStreamUrl('rtsp://192.168.1.50/stream')).toBeNull();
      expect(parseHttpStreamUrl('not-a-url')).toBeNull();
    });
  });
});
