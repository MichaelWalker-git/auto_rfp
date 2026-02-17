/**
 * Pinecone kbId Backfill Script
 *
 * This script updates existing Pinecone vectors to include the `kbId` metadata field.
 * It parses the kbId from the existing `sort_key` metadata field.
 *
 * Usage:
 *   PINECONE_API_KEY=xxx PINECONE_INDEX=yyy npx tsx scripts/backfill-pinecone-kbid.ts [--dry-run]
 *
 * The script:
 * 1. Lists all namespaces (org IDs) in the Pinecone index
 * 2. For each namespace, fetches all vectors
 * 3. For each vector, extracts kbId from sort_key metadata
 * 4. Updates the vector metadata with the kbId field
 */

import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

if (!PINECONE_API_KEY || !PINECONE_INDEX) {
  console.error('ERROR: PINECONE_API_KEY and PINECONE_INDEX environment variables are required.');
  process.exit(1);
}

const client = new Pinecone({ apiKey: PINECONE_API_KEY });

function extractKbIdFromSK(sortKey: string, type: string): string | undefined {
  if (!sortKey) return undefined;

  const parts = sortKey.split('#');

  if (type === 'chunk') {
    // Document chunk SK format: "KB#{kbId}#DOC#{docId}"
    if (parts.length >= 2 && parts[0] === 'KB') {
      return parts[1];
    }
  } else if (type === 'content_library') {
    // Content library SK format: "{orgId}#{kbId}#{itemId}"
    if (parts.length >= 2) {
      return parts[1];
    }
  }

  return undefined;
}

async function backfillNamespace(indexName: string, namespace: string): Promise<{ updated: number; skipped: number; errors: number }> {
  const index = client.Index(indexName);
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`\n  Processing namespace: ${namespace}`);

  // Use a dummy vector to query all vectors in the namespace
  // We need to know the dimension — try 1024 (Titan v2)
  const dummyVector = new Array(1024).fill(0);

  try {
    // Query in batches
    const results = await index.namespace(namespace).query({
      vector: dummyVector,
      topK: 10000,
      includeMetadata: true,
      includeValues: false,
    });

    const matches = results.matches || [];
    console.log(`  Found ${matches.length} vectors`);

    const toUpdate: Array<{ id: string; metadata: Record<string, any> }> = [];

    for (const match of matches) {
      const metadata = match.metadata as Record<string, any> | undefined;
      if (!metadata) {
        skipped++;
        continue;
      }

      // Skip if kbId already exists
      if (metadata.kbId) {
        skipped++;
        continue;
      }

      const sortKey = metadata.sort_key as string | undefined;
      const type = metadata.type as string | undefined;

      if (!sortKey || !type) {
        skipped++;
        continue;
      }

      const kbId = extractKbIdFromSK(sortKey, type);
      if (!kbId) {
        console.warn(`  WARNING: Could not extract kbId from sort_key="${sortKey}" type="${type}" id="${match.id}"`);
        skipped++;
        continue;
      }

      toUpdate.push({
        id: match.id,
        metadata: { ...metadata, kbId },
      });
    }

    console.log(`  Vectors to update: ${toUpdate.length}, already have kbId: ${skipped}`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update ${toUpdate.length} vectors`);
      if (toUpdate.length > 0) {
        console.log(`  Sample: id="${toUpdate[0].id}" → kbId="${toUpdate[0].metadata.kbId}"`);
      }
      return { updated: 0, skipped, errors: 0 };
    }

    // Update in batches
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);

      try {
        // Pinecone doesn't have a direct metadata-only update.
        // We need to use the update endpoint for each vector.
        for (const item of batch) {
          await index.namespace(namespace).update({
            id: item.id,
            metadata: { kbId: item.metadata.kbId },
          });
          updated++;
        }

        console.log(`  Updated ${Math.min(i + BATCH_SIZE, toUpdate.length)}/${toUpdate.length} vectors`);
      } catch (err) {
        console.error(`  ERROR updating batch at offset ${i}:`, (err as Error)?.message);
        errors += batch.length;
      }
    }
  } catch (err) {
    console.error(`  ERROR querying namespace ${namespace}:`, (err as Error)?.message);
    errors++;
  }

  return { updated, skipped, errors };
}

async function main() {
  console.log('=== Pinecone kbId Backfill Script ===');
  console.log(`Index: ${PINECONE_INDEX}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update vectors)'}`);
  console.log('');

  const index = client.Index(PINECONE_INDEX);

  // Get index stats to find namespaces
  const stats = await index.describeIndexStats();
  const namespaces = Object.keys(stats.namespaces || {});

  console.log(`Found ${namespaces.length} namespaces (organizations)`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const namespace of namespaces) {
    if (!namespace) continue; // skip default namespace

    const result = await backfillNamespace(PINECONE_INDEX, namespace);
    totalUpdated += result.updated;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Total skipped (already had kbId or no sort_key): ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);

  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. Run without --dry-run to apply changes.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
