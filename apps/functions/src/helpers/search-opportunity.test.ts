import {
  withSourceTimeout,
  SOURCE_TIMEOUT_MS,
  higherGovPageSize,
  HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE,
} from './search-opportunity';

describe('higherGovPageSize', () => {
  it('caps the page size when querying by search_id', () => {
    // HigherGov 500s at page_size >= 20 on the search_id path, and 25 is the
    // default — so this cap is what makes saved HigherGov searches return at all.
    expect(higherGovPageSize(25, true)).toBe(HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE);
    expect(higherGovPageSize(100, true)).toBe(HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE);
  });

  it('leaves the page size alone without a search_id', () => {
    expect(higherGovPageSize(25, false)).toBe(25);
    expect(higherGovPageSize(100, false)).toBe(100);
  });

  it('never raises a page size that is already below the cap', () => {
    expect(higherGovPageSize(5, true)).toBe(5);
    expect(higherGovPageSize(5, false)).toBe(5);
  });

  it('stays under the threshold HigherGov rejects', () => {
    // Measured against the live API: 5 and 10 succeed, 20 and above return 500.
    expect(HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE).toBeLessThan(20);
  });
});

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
