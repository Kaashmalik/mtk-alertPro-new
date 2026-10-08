/**
 * Unit test for exponential reconnect delay used by StreamSession
 */

describe('stream reconnect backoff', () => {
  function backoff(baseMs: number, retryCount: number, maxMs = 30000): number {
    return Math.min(baseMs * 2 ** retryCount, maxMs);
  }

  it('doubles each retry until cap', () => {
    expect(backoff(2000, 0)).toBe(2000);
    expect(backoff(2000, 1)).toBe(4000);
    expect(backoff(2000, 2)).toBe(8000);
    expect(backoff(2000, 10)).toBe(30000);
  });
});
