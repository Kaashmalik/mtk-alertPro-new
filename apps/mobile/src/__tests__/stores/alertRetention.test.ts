/**
 * Alert retention (maxAlertHistory) tests.
 *
 * The plan limits advertised "7 alerts" on free and "30" on pro, but the fetch
 * used a hardcoded limit of 100 and nothing deleted old rows, so the table grew
 * without bound. These lock the plan-aware behaviour in.
 */

import { supabase } from '@/lib/supabase/client';
import { useAlertStore } from '@/stores/alertStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
    })),
  },
}));

jest.mock('@/lib/audio/alarmService', () => ({
  alarmService: { play: jest.fn(), stop: jest.fn() },
}));

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

/** Build a chainable query builder that resolves to `rows`. */
function mockSelect(rows: unknown[]) {
  const builder: Record<string, jest.Mock> = {};
  const chain = () => builder;
  for (const m of [
    'select',
    'order',
    'eq',
    'range',
    'limit',
    'in',
    'delete',
    'insert',
    'update',
  ]) {
    builder[m] = jest.fn().mockImplementation(chain);
  }
  // PostgREST resolves the promise on the terminal await of the chain; emulate by
  // making `then` yield the result.
  (builder as any).then = (resolve: (v: unknown) => void) =>
    resolve({ data: rows, error: null });
  (supabase.from as jest.Mock).mockReturnValue(builder);
  return builder;
}

describe('alert retention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAlertStore.setState({
      alerts: [],
      unreadCount: 0,
      error: null,
      isLoading: false,
    });
    useSubscriptionStore.setState({ currentTier: 'free', expiresAt: null });
  });

  it('fetches no more than the free-tier allowance (7)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      camera_id: 'cam-1',
      user_id: 'u1',
      type: 'person',
      confidence: 0.9,
      is_read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    const builder = mockSelect(rows);
    await useAlertStore.getState().fetchAlerts();

    // Server is asked for exactly the free cap, not a hardcoded 100.
    expect(builder.limit).toHaveBeenCalledWith(7);
    // And the list is capped regardless of what came back.
    expect(useAlertStore.getState().alerts).toHaveLength(7);
  });

  it('fetches up to the pro allowance (30) for an active subscription', async () => {
    useSubscriptionStore.setState({ currentTier: 'pro', expiresAt: FUTURE });

    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `a${i}`,
      camera_id: 'cam-1',
      user_id: 'u1',
      type: 'person',
      confidence: 0.9,
      is_read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    const builder = mockSelect(rows);
    await useAlertStore.getState().fetchAlerts();

    expect(builder.limit).toHaveBeenCalledWith(30);
    expect(useAlertStore.getState().alerts).toHaveLength(30);
  });

  it('falls back to the free allowance once the subscription has expired', async () => {
    useSubscriptionStore.setState({
      currentTier: 'pro',
      expiresAt: new Date(Date.now() - 1000),
    });

    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `a${i}`,
      camera_id: 'cam-1',
      user_id: 'u1',
      type: 'person',
      confidence: 0.9,
      is_read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    const builder = mockSelect(rows);
    await useAlertStore.getState().fetchAlerts();

    expect(builder.limit).toHaveBeenCalledWith(7);
    expect(useAlertStore.getState().alerts).toHaveLength(7);
  });

  it('keeps every row for the unlimited business plan', async () => {
    useSubscriptionStore.setState({
      currentTier: 'business',
      expiresAt: FUTURE,
    });

    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `a${i}`,
      camera_id: 'cam-1',
      user_id: 'u1',
      type: 'person',
      confidence: 0.9,
      is_read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    mockSelect(rows);
    await useAlertStore.getState().fetchAlerts();

    expect(useAlertStore.getState().alerts).toHaveLength(40);
  });
});
