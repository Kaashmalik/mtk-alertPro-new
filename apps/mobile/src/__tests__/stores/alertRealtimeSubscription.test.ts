/**
 * Regression tests for the realtime subscription leak that produced
 * "cannot add postgres_changes callback for realtime ... subscribe()" and a
 * full-screen "Something went wrong".
 *
 * Supabase identifies a channel by topic name. The root layout used to
 * subscribe on mount *and* on every app foreground while discarding the
 * unsubscribe, and the Alerts tab subscribed again -- so duplicate
 * 'alerts-realtime' topics collided and the postgres_changes binding was
 * rejected. These tests pin the fix: one shared channel, reference counted.
 */

// `mock`-prefixed so babel-plugin-jest-hoist allows the factory to close over them.
const mockChannel = {
  on: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn().mockResolvedValue('ok'),
};
mockChannel.on.mockReturnValue(mockChannel);
mockChannel.subscribe.mockReturnValue(mockChannel);

const mockRemoveChannel = jest.fn().mockResolvedValue(undefined);
const mockChannelFactory = jest.fn((_topic: string) => mockChannel);

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    channel: (topic: string) => mockChannelFactory(topic),
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });
      return chain;
    },
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
    },
  },
}));

jest.mock('@/lib/audio/alarmService', () => ({
  alarmService: {
    playAlarm: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
  },
}));

type AlertStore = typeof import('@/stores/alertStore').useAlertStore;

/** Load a pristine copy of the store so module-level channel state is fresh. */
function loadStore(): AlertStore {
  let store: AlertStore | undefined;
  jest.isolateModules(() => {
    store = require('@/stores/alertStore').useAlertStore as AlertStore;
  });
  if (!store) throw new Error('failed to load alertStore');
  return store;
}

describe('alert realtime subscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChannel.on.mockReturnValue(mockChannel);
    mockChannel.subscribe.mockReturnValue(mockChannel);
    mockChannelFactory.mockImplementation(() => mockChannel);
    mockRemoveChannel.mockResolvedValue(undefined);
  });

  it('creates exactly one channel no matter how many callers subscribe', () => {
    const store = loadStore();

    const releaseA = store.getState().subscribeToAlerts();
    const releaseB = store.getState().subscribeToAlerts();
    const releaseC = store.getState().subscribeToAlerts();

    expect(mockChannelFactory).toHaveBeenCalledTimes(1);
    expect(mockChannelFactory).toHaveBeenCalledWith('alerts-realtime');
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
    releaseC();
  });

  it('keeps the channel alive until the last caller releases it', () => {
    const store = loadStore();

    const releaseA = store.getState().subscribeToAlerts();
    const releaseB = store.getState().subscribeToAlerts();

    releaseA();
    // B still holds a reference: the channel must survive.
    expect(mockRemoveChannel).not.toHaveBeenCalled();

    releaseB();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('ignores a repeated release from the same caller', () => {
    const store = loadStore();

    const releaseA = store.getState().subscribeToAlerts();
    const releaseB = store.getState().subscribeToAlerts();

    releaseA();
    releaseA();
    releaseA();
    // Still one live reference, so nothing should be torn down yet.
    expect(mockRemoveChannel).not.toHaveBeenCalled();

    releaseB();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it('can be resubscribed after full teardown', () => {
    const store = loadStore();

    store.getState().subscribeToAlerts()();
    expect(mockChannelFactory).toHaveBeenCalledTimes(1);

    store.getState().subscribeToAlerts();
    expect(mockChannelFactory).toHaveBeenCalledTimes(2);
  });

  it('never throws out of subscribeToAlerts, so a realtime failure cannot white-screen the app', () => {
    // Reproduces the on-device crash: the SDK blew up while registering the
    // postgres_changes callback. This runs inside a useEffect, so a throw here
    // unmounted the tree into the root ErrorBoundary.
    mockChannelFactory.mockImplementation(() => {
      throw new Error(
        'cannot add postgres_changes callback for realtime postgres_changes',
      );
    });

    const store = loadStore();
    let release: () => void = () => {};
    expect(() => {
      release = store.getState().subscribeToAlerts();
    }).not.toThrow();

    // The returned release must still be safe to call.
    expect(() => release()).not.toThrow();
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  it('survives a removeChannel failure without throwing', () => {
    mockRemoveChannel.mockImplementationOnce(() => {
      throw new Error('socket already closed');
    });

    const store = loadStore();
    const release = store.getState().subscribeToAlerts();
    expect(() => release()).not.toThrow();
  });

  it('reports a channel error as a recoverable message rather than throwing', () => {
    const store = loadStore();

    // Capture the status callback the store handed to .subscribe().
    store.getState().subscribeToAlerts();
    const statusCb = mockChannel.subscribe.mock.calls[0][0] as (
      s: string,
    ) => void;

    expect(() => statusCb('CHANNEL_ERROR')).not.toThrow();
    expect(store.getState().error).toMatch(/reconnect/i);
  });
});
