import { sleep } from './sleep';

describe('sleep', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves after the given delay', async () => {
    jest.useFakeTimers();
    const promise = sleep(500);
    jest.advanceTimersByTime(500);
    await expect(promise).resolves.toBeUndefined();
  });

  it('does not resolve before the delay elapses', async () => {
    jest.useFakeTimers();
    let resolved = false;
    void sleep(500).then(() => {
      resolved = true;
    });
    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(resolved).toBe(false);
  });
});
