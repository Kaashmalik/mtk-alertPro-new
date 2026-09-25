/**
 * rtspHelper tests — credential handling.
 *
 * Security invariant: credentials must only ever live in the (encrypted)
 * username/password columns. No generated, stored, or displayed URL string may
 * contain user:pass@.
 */

import {
  generateRtspUrl,
  sanitizeRtspUrl,
  maskRtspUrl,
} from '@/lib/camera/rtspHelper';

describe('generateRtspUrl', () => {
  it('returns a credential-free URL even when credentials are supplied', () => {
    const url = generateRtspUrl('hikvision', '192.168.0.64', {
      username: 'admin',
      password: 's3cret',
    });

    expect(url).toBe('rtsp://192.168.0.64:554/Streaming/Channels/101');
    expect(url).not.toContain('@');
    expect(url).not.toContain('s3cret');
    expect(url).not.toContain('admin');
  });

  it('drops brand default-password placeholders entirely', () => {
    const url = generateRtspUrl('uniview', '10.0.0.20');

    expect(url).toBe('rtsp://10.0.0.20:554/media/video1');
    expect(url).not.toContain('@');
    expect(url).not.toContain('123456');
  });

  it('honours port / channel / substream options', () => {
    expect(
      generateRtspUrl('dahua', '10.0.0.5', {
        port: 8554,
        channel: 2,
        useSubStream: true,
      })
    ).toBe('rtsp://10.0.0.5:8554/cam/realmonitor?channel=1&subtype=1');

    expect(generateRtspUrl('custom', '10.0.0.9')).toBe(
      'rtsp://10.0.0.9:554/stream'
    );
  });

  it('returns empty string for an unknown brand', () => {
    expect(generateRtspUrl('nope', '1.2.3.4')).toBe('');
  });
});

describe('sanitizeRtspUrl', () => {
  it('strips user:pass@ userinfo from RTSP URLs', () => {
    expect(
      sanitizeRtspUrl('rtsp://admin:p%40ss@192.168.1.10:554/stream')
    ).toBe('rtsp://192.168.1.10:554/stream');

    expect(sanitizeRtspUrl('rtsp://admin@192.168.1.10/stream')).toBe(
      'rtsp://192.168.1.10/stream'
    );
  });

  it('handles a raw @ inside the password without breaking the host', () => {
    expect(sanitizeRtspUrl('rtsp://admin:p@ss@192.168.1.10/stream')).toBe(
      'rtsp://192.168.1.10/stream'
    );
  });

  it('also covers http(s) and rtsps schemes', () => {
    expect(sanitizeRtspUrl('http://u:p@10.0.0.5/mjpg')).toBe(
      'http://10.0.0.5/mjpg'
    );
    expect(sanitizeRtspUrl('rtsps://u:p@10.0.0.5/live')).toBe(
      'rtsps://10.0.0.5/live'
    );
  });

  it('leaves already-clean URLs untouched', () => {
    const clean = 'rtsp://192.168.1.10:554/stream';
    expect(sanitizeRtspUrl(clean)).toBe(clean);
    expect(sanitizeRtspUrl('')).toBe('');
    expect(sanitizeRtspUrl('garbage')).toBe('garbage');
  });
});

describe('maskRtspUrl', () => {
  it('masks userinfo without leaking the credentials', () => {
    const masked = maskRtspUrl('rtsp://admin:s3cret@192.168.1.10:554/stream');

    expect(masked).toBe('rtsp://***@192.168.1.10:554/stream');
    expect(masked).not.toContain('s3cret');
    expect(masked).not.toContain('admin');
  });

  it('renders clean URLs as-is', () => {
    const clean = 'rtsp://192.168.1.10:554/stream';
    expect(maskRtspUrl(clean)).toBe(clean);
  });
});