import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AlertsScreen from '@/app/(tabs)/alerts';
import { useAlertStore } from '@/stores/alertStore';
import type { Alert } from '@/types';

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('@/components/ads/BannerAd', () => ({ AdBanner: () => null }));
jest.mock('@/components/ads/InterstitialAd', () => ({
  useInterstitialAd: () => ({ show: jest.fn() }),
}));
jest.mock('@/lib/audio/alarmService', () => ({
  alarmService: { play: jest.fn(), stop: jest.fn() },
}));
jest.mock('@/lib/notifications/service', () => ({
  sendLocalNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription', () => ({
  subscriptionService: { getAvailableProviders: () => [] },
}));

jest.mock('@/lib/supabase/client', () => {
  const chain: any = new Proxy(
    {},
    {
      get: () => () => chain,
    },
  );
  // `await` on the chain must resolve, not hang.
  (chain as any).then = (resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null, count: 0 });

  return {
    supabase: {
      from: jest.fn(() => chain),
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
      channel: jest.fn(() => ({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockReturnThis(),
        unsubscribe: jest.fn(),
      })),
    },
  };
});

const makeAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-1',
  cameraId: 'cam-1',
  userId: 'u1',
  type: 'person',
  confidence: 0.91,
  isRead: false,
  createdAt: new Date(),
  metadata: {},
  ...overrides,
});

describe('AlertsScreen — tapping an alert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAlertStore.setState({
      alerts: [],
      unreadCount: 0,
      isLoading: false,
      error: null,
    });
    // Stub the async actions so the tap does not hit Supabase.
    useAlertStore.setState({
      fetchAlerts: jest.fn().mockResolvedValue(undefined),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      markAllAsRead: jest.fn().mockResolvedValue(undefined),
      deleteAlert: jest.fn().mockResolvedValue(undefined),
      subscribeToAlerts: jest.fn(() => () => {}),
    } as never);
  });

  it('renders the list and survives a tap without a render error', async () => {
    useAlertStore.setState({ alerts: [makeAlert()], unreadCount: 1 });

    const screen = render(<AlertsScreen />);
    // AlertCard renders the detection type as an icon, not text; the timestamp
    // is the stable, always-present marker that the row rendered.
    await waitFor(() => expect(screen.getByText(/AM|PM/)).toBeTruthy());

    // This is the action that crashed on device.
    await act(async () => {
      fireEvent.press(screen.getByText(/AM|PM/));
    });

    // If the tap threw during render the tree would be replaced by the error
    // boundary and the row would be gone.
    expect(screen.getByText(/AM|PM/)).toBeTruthy();
  });

  it('renders an alert that carries a snapshot url', async () => {
    useAlertStore.setState({
      alerts: [
        makeAlert({ id: 'alert-2', snapshotUrl: 'https://example.com/a.jpg' }),
      ],
      unreadCount: 1,
    });

    const screen = render(<AlertsScreen />);
    await waitFor(() => expect(screen.getByText(/AM|PM/)).toBeTruthy());
    expect(screen.getByText(/AM|PM/)).toBeTruthy();
  });

  it('renders an alert with an unparseable timestamp instead of crashing', async () => {
    // The sanitizer coerces dates today, but AlertCard formats whatever it is
    // given. `toLocaleTimeString()` on an Invalid Date throws RangeError, which
    // blanked the whole Alerts tab from inside FlatList renderItem.
    useAlertStore.setState({
      alerts: [makeAlert({ id: 'alert-3', createdAt: new Date('nonsense') })],
      unreadCount: 1,
    });

    const screen = render(<AlertsScreen />);

    // It must render the placeholder, not throw.
    await waitFor(() => expect(screen.getByText('--')).toBeTruthy());
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('does not raise an unhandled rejection when mark-all-read fails', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    useAlertStore.setState({
      alerts: [makeAlert()],
      unreadCount: 1,
      // markAllAsRead rethrows on a Supabase error; the button used to pass it
      // straight to onPress, so an offline tap produced an unhandled rejection.
      markAllAsRead: jest.fn().mockRejectedValue(new Error('offline')),
    } as never);

    const screen = render(<AlertsScreen />);
    await waitFor(() => expect(screen.getByText('Mark all read')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByText('Mark all read'));
    });

    // Let any stray rejection surface.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('does not raise an unhandled rejection when tapping an alert fails', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    useAlertStore.setState({
      alerts: [makeAlert()],
      unreadCount: 1,
      markAsRead: jest.fn().mockRejectedValue(new Error('offline')),
    } as never);

    const screen = render(<AlertsScreen />);
    await waitFor(() => expect(screen.getByText(/AM|PM/)).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByText(/AM|PM/));
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    process.off('unhandledRejection', unhandled);
  });
});
