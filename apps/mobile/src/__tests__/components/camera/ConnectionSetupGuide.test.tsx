import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ConnectionSetupGuide } from '@/components/camera/ConnectionSetupGuide';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;

function setRelay(value?: string) {
  if (value === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined would set the literal string "undefined", which mediaServerStatus() treats as configured
    delete process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;
  } else {
    process.env.EXPO_PUBLIC_MEDIA_SERVER_URL = value;
  }
}

describe('ConnectionSetupGuide', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setRelay(undefined);
    (global.fetch as jest.Mock) = jest.fn();
  });

  afterAll(() => {
    setRelay(ORIGINAL_ENV);
  });

  it('explains the relay is not configured and does not fetch', async () => {
    const screen = render(<ConnectionSetupGuide />);

    await waitFor(() =>
      expect(screen.getByText('No relay configured')).toBeTruthy(),
    );
    // With nothing configured there is nothing to probe.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Connect a camera')).toBeTruthy();
  });

  it('reports a healthy relay when /health returns mediamtx connected', async () => {
    setRelay('http://192.168.1.50:3001');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        services: { mediamtx: 'connected' },
      }),
    });

    const screen = render(<ConnectionSetupGuide />);

    await waitFor(() =>
      expect(screen.getByText('Relay connected')).toBeTruthy(),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.50:3001/health',
      expect.anything(),
    );
  });

  it('reports degraded when the relay is up but MediaMTX is not', async () => {
    setRelay('http://192.168.1.50:3001');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ services: { mediamtx: 'disconnected' } }),
    });

    const screen = render(<ConnectionSetupGuide />);

    await waitFor(() =>
      expect(screen.getByText('Relay up, MediaMTX not connected')).toBeTruthy(),
    );
  });

  it('reports unreachable when the relay cannot be contacted', async () => {
    setRelay('http://192.168.1.50:3001');
    (global.fetch as jest.Mock).mockRejectedValue(
      new Error('Network request failed'),
    );

    const screen = render(<ConnectionSetupGuide />);

    await waitFor(() =>
      expect(screen.getByText('Relay unreachable')).toBeTruthy(),
    );
  });

  it('re-runs the check when "Check again" is pressed', async () => {
    setRelay('http://192.168.1.50:3001');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ services: { mediamtx: 'connected' } }),
    });

    const screen = render(<ConnectionSetupGuide />);
    await waitFor(() =>
      expect(screen.getByText('Relay connected')).toBeTruthy(),
    );
    const before = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByText('Check again'));
    });

    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });
});
