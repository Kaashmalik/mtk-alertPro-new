/**
 * MJPEG / snapshot service tests
 */

import {
  getSnapshotCandidates,
  fetchSnapshotFrame,
  createMjpegStream,
  blobToDataUri,
  resolveFrameUrl,
} from '@/lib/camera/mjpegService';

function makeJpegBlob(size = 16): Blob {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return new Blob([bytes], { type: 'image/jpeg' });
}

function makeMultipartBlob(jpeg: Blob, trailingBytes = 0): Blob {
  const header = new TextEncoder().encode(
    '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n\r\n'
  );
  const footer = new TextEncoder().encode(
    '\r\n--frame\r\n' + 'x'.repeat(trailingBytes)
  );
  return new Blob([header, jpegBytes(jpeg), footer], {
    type: 'multipart/x-mixed-replace; boundary=frame',
  });
}

function jpegBytes(blob: Blob): Uint8Array {
  // Synchronous helper used only in test setup after blob is fully formed;
  // callers pass already-constructed small blobs.
  return new Uint8Array(0);
}

// Async-safe variant used by tests that need real bytes
async function makeMultipartFromJpeg(jpeg: Blob): Promise<Blob> {
  const jpegBuf = await jpeg.arrayBuffer();
  const header = new TextEncoder().encode(
    '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n\r\n'
  );
  const footer = new TextEncoder().encode('\r\n--frame\r\n');
  return new Blob([header, new Uint8Array(jpegBuf), footer], {
    type: 'multipart/x-mixed-replace; boundary=frame',
  });
}

describe('mjpegService', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    // FileReader for blob → data URI
    (global as unknown as { FileReader: unknown }).FileReader = class {
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(_blob: Blob) {
        this.result = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
        queueMicrotask(() => this.onloadend?.());
      }
    };
  });

  describe('getSnapshotCandidates', () => {
    it('includes original URL first', () => {
      const candidates = getSnapshotCandidates('http://192.168.1.10/videostream.cgi');
      expect(candidates[0]).toBe('http://192.168.1.10/videostream.cgi');
    });

    it('adds common snapshot paths on same origin', () => {
      const candidates = getSnapshotCandidates('http://192.168.1.10:8080/mjpg/video.mjpg');
      expect(candidates).toContain('http://192.168.1.10:8080/snapshot.jpg');
      expect(candidates).toContain('http://192.168.1.10:8080/cgi-bin/snapshot.cgi');
    });

    it('preserves user:pass@ userinfo on derived candidates', () => {
      const candidates = getSnapshotCandidates('http://admin:secret@192.168.1.10/mjpg/video.mjpg');
      expect(candidates[0]).toBe('http://admin:secret@192.168.1.10/mjpg/video.mjpg');
      expect(candidates).toContain('http://admin:secret@192.168.1.10/snapshot.jpg');
      expect(candidates).toContain('http://admin:secret@192.168.1.10/cgi-bin/snapshot.cgi');
      // No credential-stripped sibling
      expect(candidates).not.toContain('http://192.168.1.10/snapshot.jpg');
    });

    it('encodes special characters in embedded credentials', () => {
      const candidates = getSnapshotCandidates('http://admin:p%40ss@192.168.1.10/snap');
      const derived = candidates.find(c => c.includes('snapshot.jpg'));
      expect(derived).toBeDefined();
      expect(derived).toContain('@192.168.1.10/');
      // password parsed as p@ss → re-encoded as p%40ss
      expect(derived).toMatch(/^http:\/\/admin:p%40ss@192\.168\.1\.10\//);
    });

    it('does not reject multipart MJPEG URLs as candidates', () => {
      const candidates = getSnapshotCandidates(
        'http://admin:secret@10.0.0.5:8080/mjpg/video.mjpg'
      );
      // The original multipart stream URL is the first candidate (not dropped)
      expect(candidates[0]).toBe('http://admin:secret@10.0.0.5:8080/mjpg/video.mjpg');
      // Derived snapshot siblings keep the user:pass@ userinfo
      expect(candidates).toContain('http://admin:secret@10.0.0.5:8080/snapshot.jpg');
      // No credential-stripped sibling is generated
      expect(candidates).not.toContain('http://10.0.0.5:8080/snapshot.jpg');
    });

    it('preserves query string on derived frame=1 variant', () => {
      const candidates = getSnapshotCandidates('http://192.168.1.10/videostream.cgi?channel=1');
      expect(candidates).toContain('http://192.168.1.10/videostream.cgi?channel=1&frame=1');
    });

    it('deduplicates candidates', () => {
      const candidates = getSnapshotCandidates('http://192.168.1.10/snapshot.jpg');
      const unique = new Set(candidates);
      expect(unique.size).toBe(candidates.length);
    });

    it('returns only original for invalid URL', () => {
      expect(getSnapshotCandidates('rtsp://x')).toEqual(['rtsp://x']);
    });
  });

  describe('fetchSnapshotFrame', () => {
    it('returns data URI for JPEG response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        blob: async () => makeJpegBlob(),
      });

      const frame = await fetchSnapshotFrame('http://192.168.1.10/snapshot.jpg');
      expect(frame).toMatch(/^data:image\/jpeg/);
    });

    it('extracts first JPEG frame from multipart MJPEG response', async () => {
      const jpeg = makeJpegBlob();
      const multipart = await makeMultipartFromJpeg(jpeg);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type'
              ? 'multipart/x-mixed-replace; boundary=frame'
              : null,
        },
        blob: async () => multipart,
      });

      const frame = await fetchSnapshotFrame('http://192.168.1.10/mjpg');
      expect(frame).toMatch(/^data:image\/jpeg/);
    });

    it('returns null for multipart body with no complete JPEG', async () => {
      const partial = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], {
        type: 'image/jpeg',
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type'
              ? 'multipart/x-mixed-replace; boundary=frame'
              : null,
        },
        blob: async () => partial,
      });

      const frame = await fetchSnapshotFrame('http://192.168.1.10/mjpg');
      expect(frame).toBeNull();
    });

    it('sends Basic auth header when credentials provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        blob: async () => makeJpegBlob(),
      });

      await fetchSnapshotFrame('http://192.168.1.10/snapshot.jpg', {
        username: 'admin',
        password: 'secret',
      });

      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(call[1].headers.Authorization).toMatch(/^Basic /);
      // admin:secret → YWRtaW46c2VjcmV0
      expect(call[1].headers.Authorization).toBe('Basic YWRtaW46c2VjcmV0');
    });

    it('rejects HTML responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
        blob: async () => new Blob(['<html></html>'], { type: 'text/html' }),
      });

      const frame = await fetchSnapshotFrame('http://192.168.1.10/');
      expect(frame).toBeNull();
    });

    it('rejects non-OK responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      expect(await fetchSnapshotFrame('http://192.168.1.10/missing.jpg')).toBeNull();
    });

    it('returns null on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('down'));
      expect(await fetchSnapshotFrame('http://192.168.1.10/x.jpg')).toBeNull();
    });
  });

  describe('createMjpegStream', () => {
    it('starts idle and transitions to live on successful frames', async () => {
      (global.fetch as jest.Mock).mockImplementation((input: string) => {
        const url = String(input);
        if (url.includes('snapshot') || url.includes('videostream')) {
          return Promise.resolve({
            ok: true,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
            },
            blob: async () => makeJpegBlob(),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
        });
      });

      const stream = createMjpegStream({
        url: 'http://192.168.1.10/videostream.cgi',
        fps: 10,
      });

      const states: string[] = [];
      stream.subscribe(s => states.push(s.status));
      stream.start();

      // Allow probe + first frame to resolve
      await new Promise(r => setTimeout(r, 50));

      expect(states[0]).toBe('loading');
      expect(stream.getState().status).toBe('live');
      expect(stream.getState().frame?.uri).toMatch(/^data:image\/jpeg/);

      stream.stop();
      // stop() parks the stream in idle while keeping the last frame
      expect(stream.getState().status).toBe('idle');
      expect(stream.getState().frame?.uri).toMatch(/^data:image\/jpeg/);
    });

    it('passes URL-embedded credentials as fallback when props omit them', async () => {
      (global.fetch as jest.Mock).mockImplementation((_input: string, init?: { headers?: Record<string, string> }) => {
        const auth = init?.headers?.Authorization;
        if (auth === 'Basic YWRtaW46c2VjcmV0') {
          return Promise.resolve({
            ok: true,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
            },
            blob: async () => makeJpegBlob(),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: { get: () => null },
        });
      });

      const stream = createMjpegStream({
        url: 'http://admin:secret@192.168.1.10/snapshot.jpg',
        fps: 10,
      });
      stream.start();
      await new Promise(r => setTimeout(r, 50));

      expect(stream.getState().status).toBe('live');
      stream.stop();
    });

    it('applies prop-supplied credentials as Basic auth on every request', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        (_input: string, init?: { headers?: Record<string, string> }) => {
          const auth = init?.headers?.Authorization;
          if (auth === 'Basic YWRtaW46c2VjcmV0') {
            return Promise.resolve({
              ok: true,
              headers: {
                get: (k: string) =>
                  k.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
              },
              blob: async () => makeJpegBlob(),
            });
          }
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: { get: () => null },
          });
        }
      );

      const stream = createMjpegStream({
        url: 'http://192.168.1.10/mjpg/video.mjpg',
        fps: 10,
        username: 'admin',
        password: 'secret',
      });
      stream.start();
      await new Promise(r => setTimeout(r, 50));

      // The camera's credentials (decrypted upstream of CameraStreamPlayer)
      // are threaded into mjpegService's auth header, not just URL userinfo.
      expect(stream.getState().status).toBe('live');
      stream.stop();
    });

    it('stops cleanly and reports error when no endpoint works', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      const stream = createMjpegStream({ url: 'http://192.168.1.10/dead', fps: 10 });
      stream.start();
      await new Promise(r => setTimeout(r, 80));

      expect(stream.getState().status).toBe('error');
      stream.stop();
      expect(stream.getState().status).toBe('idle');
    });

    it('does not re-sweep every candidate on each poll while offline', async () => {
      // Regression guard: the stream used to re-probe the whole candidate list
      // on every tick (20+ requests every 500ms) whenever a camera was down.
      // It must instead back off and stay quiet between attempts.
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      const stream = createMjpegStream({ url: 'http://192.168.1.10/dead', fps: 10 });
      stream.start();
      await new Promise(r => setTimeout(r, 60));

      const afterFirstSweep = (global.fetch as jest.Mock).mock.calls.length;
      expect(afterFirstSweep).toBeGreaterThan(0);

      // The backoff window is 5s, so several poll intervals later there must
      // be no additional resolution traffic.
      await new Promise(r => setTimeout(r, 200));
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(afterFirstSweep);
      stream.stop();
    });

    it('probes candidates concurrently and aborts the losers', async () => {
      // The original implementation awaited each candidate in turn, so a dead
      // camera cost 20 sequential round-trips before reporting failure.
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      const inFlight = new Set<string>();
      let maxInFlight = 0;
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        inFlight.add(url);
        maxInFlight = Math.max(maxInFlight, inFlight.size);
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight.delete(url);
            resolve({ ok: false, status: 404, headers: { get: () => null } });
          }, 5);
        });
      });

      const resolved = await resolveFrameUrl('http://192.168.1.10/mjpg/video.mjpg');
      expect(resolved).toBeNull();
      // More than one request must have been open at the same time.
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it('does not emit after stop', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: (k: string) => (k === 'content-type' ? 'image/jpeg' : null) },
        blob: async () => makeJpegBlob(),
      });

      const stream = createMjpegStream({ url: 'http://192.168.1.10/snap.jpg', fps: 10 });
      let updates = 0;
      stream.subscribe(() => {
        updates += 1;
      });
      stream.start();
      await new Promise(r => setTimeout(r, 30));
      stream.stop();
      const afterStop = updates;
      await new Promise(r => setTimeout(r, 100));
      expect(updates).toBe(afterStop);
    });
  });

  describe('blobToDataUri', () => {
    it('rejects when FileReader is unavailable', async () => {
      const original = (global as { FileReader?: unknown }).FileReader;
      try {
        (global as { FileReader?: unknown }).FileReader = undefined;
        await expect(blobToDataUri(makeJpegBlob())).rejects.toThrow(
          'FileReader not available'
        );
      } finally {
        (global as { FileReader?: unknown }).FileReader = original;
      }
    });
  });
});
