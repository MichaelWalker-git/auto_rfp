/**
 * Per-review document-HTML cache.
 *
 * A full review loads every RFP document's HTML from S3 many times over: the
 * model's get_document_section tool, the consistency scan, C1–C6, and the
 * final anchor-validation pass each call `loadRFPDocumentHtml` independently.
 * With no memoization that is ~8–9 GetObject calls for the SAME document per
 * review.
 *
 * `PackageInventory` is built once and threaded (as the same object reference)
 * through all of those consumers, so it is a natural per-review cache key. A
 * WeakMap keyed on the inventory memoizes the load without changing any
 * consumer's signature, and lets the cache be GC'd with the inventory when the
 * review finishes.
 *
 * The in-flight PROMISE is cached (not just the resolved value) so parallel
 * augmenters loading the same doc at the same time share one round-trip. A
 * rejected load is evicted so a later caller can retry — matching the
 * best-effort ([] on failure) posture of every consumer.
 */
import { loadRFPDocumentHtml } from '@/helpers/rfp-document';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const htmlCacheByInventory = new WeakMap<PackageInventory, Map<string, Promise<string>>>();

/**
 * Load an RFP document's HTML, memoized for the lifetime of `inventory`.
 * Identical to `loadRFPDocumentHtml(htmlContentKey)` except repeated loads of
 * the same key within one review reuse the first call's result.
 */
export const loadInventoryDocHtml = (
  inventory: PackageInventory,
  htmlContentKey: string,
): Promise<string> => {
  let cache = htmlCacheByInventory.get(inventory);
  if (!cache) {
    cache = new Map();
    htmlCacheByInventory.set(inventory, cache);
  }

  const cached = cache.get(htmlContentKey);
  if (cached) return cached;

  const promise = loadRFPDocumentHtml(htmlContentKey);
  cache.set(htmlContentKey, promise);
  // Evict a failed load so a later consumer can retry instead of inheriting the
  // rejection (attach a no-op catch so this handler never surfaces as unhandled).
  promise.catch(() => cache!.delete(htmlContentKey));
  return promise;
};
