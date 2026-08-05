import { withSourceTimeout, SOURCE_TIMEOUT_MS } from './search-opportunity';

describe('withSourceTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves when the promise completes before timeout', async () => {
    const promise = Promise.resolve('data');
    const result = withSourceTimeout(promise, 'SAM.gov');
    await expect(result).resolves.toBe('data');
  });

  it('rejects with user-friendly message when promise exceeds timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 30_000));
    const raced = withSourceTimeout(slow, 'SAM.gov', 100);

    jest.advanceTimersByTime(101);

    await expect(raced).rejects.toThrow('SAM.gov is responding slowly. Please try again later.');
  });

  it('uses custom timeout when provided', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    const raced = withSourceTimeout(slow, 'DIBBS', 200);

    jest.advanceTimersByTime(199);
    // Not yet timed out
    const pending = raced.catch((e) => e.message);

    jest.advanceTimersByTime(2);
    await expect(pending).resolves.toBe('DIBBS is responding slowly. Please try again later.');
  });

  it('defaults to SOURCE_TIMEOUT_MS', () => {
    expect(SOURCE_TIMEOUT_MS).toBe(15_000);
  });

  it('propagates the original error when promise rejects before timeout', async () => {
    const failing = Promise.reject(new Error('Network error'));
    const result = withSourceTimeout(failing, 'HigherGov');
    await expect(result).rejects.toThrow('Network error');
  });
});
