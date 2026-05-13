/**
 * Cleanup script: delete old per-opportunity Pinecone namespaces.
 *
 * The solicitation index used to create one namespace per opportunity (opp_{opportunityId}).
 * This hit the 100-namespace serverless limit. We now use a single "solicitations" namespace.
 * This script removes all old opp_* namespaces (except "solicitations").
 *
 * Usage:
 *   npx tsx scripts/cleanup-pinecone-opp-namespaces.ts
 *   npx tsx scripts/cleanup-pinecone-opp-namespaces.ts --dry-run
 */

const PINECONE_INDEX = 'documents';
const KEEP_NAMESPACE = 'solicitations';

const run = async () => {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    // Try fetching from AWS Secrets Manager
    const { execSync } = await import('child_process');
    const secret = execSync(
      'aws secretsmanager get-secret-value --secret-id "auto-rfp/pinecone-api-key" --query "SecretString" --output text',
      { encoding: 'utf-8' },
    ).trim();
    if (!secret) {
      console.error('Set PINECONE_API_KEY or ensure AWS CLI can access auto-rfp/pinecone-api-key');
      process.exit(1);
    }
    process.env.PINECONE_API_KEY = secret;
  }

  const { Pinecone } = await import('@pinecone-database/pinecone');
  const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = client.Index(PINECONE_INDEX);

  const dryRun = process.argv.includes('--dry-run');

  console.log(`Fetching index stats for "${PINECONE_INDEX}"...`);
  const stats = await index.describeIndexStats();
  const namespaces = Object.keys(stats.namespaces ?? {});

  const toDelete = namespaces.filter(
    (ns) => ns.startsWith('opp_') && ns !== KEEP_NAMESPACE,
  );

  if (toDelete.length === 0) {
    console.log('No old opp_* namespaces found. Nothing to clean up.');
    return;
  }

  console.log(`Found ${toDelete.length} old namespace(s) to delete:`);
  for (const ns of toDelete) {
    const vectorCount = stats.namespaces?.[ns]?.recordCount ?? 0;
    console.log(`  - ${ns} (${vectorCount} vectors)`);
  }

  if (dryRun) {
    console.log('\n--dry-run: No changes made.');
    return;
  }

  console.log(`\nDeleting ${toDelete.length} namespace(s)...`);
  for (const ns of toDelete) {
    try {
      await index.namespace(ns).deleteAll();
      console.log(`  ✓ Deleted ${ns}`);
    } catch (err) {
      console.error(`  ✗ Failed to delete ${ns}:`, (err as Error).message);
    }
  }

  console.log('\nDone. Verifying...');
  const newStats = await index.describeIndexStats();
  const remaining = Object.keys(newStats.namespaces ?? {}).filter((ns) => ns.startsWith('opp_'));
  console.log(`Remaining opp_* namespaces: ${remaining.length}`);
};

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
