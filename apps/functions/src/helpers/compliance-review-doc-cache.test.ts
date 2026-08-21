const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

import { loadInventoryDocHtml } from './compliance-review-doc-cache';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const inventory = (): PackageInventory => ({ documents: [], forms: [] });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadInventoryDocHtml', () => {
  it('loads a key once per inventory and reuses the result for repeat loads', async () => {
    mockLoadHtml.mockResolvedValue('<p>hi</p>');
    const inv = inventory();

    const [a, b, c] = await Promise.all([
      loadInventoryDocHtml(inv, 'key-1'),
      loadInventoryDocHtml(inv, 'key-1'),
      loadInventoryDocHtml(inv, 'key-1'),
    ]);

    expect(a).toBe('<p>hi</p>');
    expect(b).toBe('<p>hi</p>');
    expect(c).toBe('<p>hi</p>');
    // Three concurrent loads of the same key → ONE S3 round-trip.
    expect(mockLoadHtml).toHaveBeenCalledTimes(1);
  });

  it('caches per key — distinct keys each load once', async () => {
    mockLoadHtml.mockImplementation((key: string) => Promise.resolve(`html:${key}`));
    const inv = inventory();

    expect(await loadInventoryDocHtml(inv, 'a')).toBe('html:a');
    expect(await loadInventoryDocHtml(inv, 'b')).toBe('html:b');
    expect(await loadInventoryDocHtml(inv, 'a')).toBe('html:a');

    expect(mockLoadHtml).toHaveBeenCalledTimes(2);
  });

  it('does not share a cache across distinct inventory objects', async () => {
    mockLoadHtml.mockResolvedValue('<p>hi</p>');
    await loadInventoryDocHtml(inventory(), 'key-1');
    await loadInventoryDocHtml(inventory(), 'key-1');
    // Different inventory reference → different cache → two loads.
    expect(mockLoadHtml).toHaveBeenCalledTimes(2);
  });

  it('evicts a failed load so a later caller can retry', async () => {
    const inv = inventory();
    mockLoadHtml.mockRejectedValueOnce(new Error('s3 down')).mockResolvedValueOnce('<p>recovered</p>');

    await expect(loadInventoryDocHtml(inv, 'key-1')).rejects.toThrow('s3 down');
    // The rejection was evicted → the retry re-loads and succeeds.
    expect(await loadInventoryDocHtml(inv, 'key-1')).toBe('<p>recovered</p>');
    expect(mockLoadHtml).toHaveBeenCalledTimes(2);
  });
});
