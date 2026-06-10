/**
 * One-off migration: fold standalone PROJECT_OUTCOME records onto their Opportunity.
 *
 * The opportunity outcome used to live in a separate DynamoDB record
 * (PK=PROJECT_OUTCOME, SK=`${orgId}#${projectId}#${opportunityId}`). It now lives
 * on the OpportunityItem itself (status + outcomeComment + winData/lossData +
 * jurisdiction/state + outcomeDate/outcomeSetBy). This copies each outcome onto its
 * opportunity, mapping the legacy PENDING status → SUBMITTED.
 *
 * Idempotent: re-running re-SETs the same values; the migrated statusHistory entry
 * is only appended once (guarded by the `migratedOutcomeAt` marker).
 *
 * Order: deploy the new code FIRST, then run this (consumers now read the
 * opportunity). The source PROJECT_OUTCOME records are left in place unless
 * --delete-source is passed (run that only after verifying the migration).
 *
 * Usage:
 *   npx tsx scripts/migrate-project-outcomes-to-opportunities.ts <table-name> [region] [--dry-run] [--delete-source]
 *
 * Examples:
 *   npx tsx scripts/migrate-project-outcomes-to-opportunities.ts RFP-table-Dev us-east-1 --dry-run
 *   npx tsx scripts/migrate-project-outcomes-to-opportunities.ts RFP-table-Dev us-east-1
 *   npx tsx scripts/migrate-project-outcomes-to-opportunities.ts RFP-table-Dev us-east-1 --delete-source
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.argv[2];
const REGION = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'us-east-1';
const DRY_RUN = process.argv.includes('--dry-run');
const DELETE_SOURCE = process.argv.includes('--delete-source');

if (!TABLE_NAME) {
  console.error('Usage: npx tsx scripts/migrate-project-outcomes-to-opportunities.ts <table-name> [region] [--dry-run] [--delete-source]');
  process.exit(1);
}

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const PROJECT_OUTCOME_PK = 'PROJECT_OUTCOME';
const OPPORTUNITY_PK = 'OPPORTUNITY';

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

interface OutcomeRecord {
  [key: string]: unknown;
  partition_key: string;
  sort_key: string;
  orgId?: string;
  projectId?: string;
  opportunityId?: string;
  status?: string;
  statusDate?: string;
  statusSetBy?: string;
  notes?: string;
  jurisdiction?: string;
  state?: string;
  winData?: unknown;
  lossData?: unknown;
}

/** Map a legacy ProjectOutcome status onto the unified opportunity status. */
const mapStatus = (status?: string): string | undefined => {
  if (!status) return undefined;
  return status === 'PENDING' ? 'SUBMITTED' : status;
};

const resolveIds = (o: OutcomeRecord): { orgId: string; projectId: string; opportunityId: string } | null => {
  // Prefer explicit attributes, fall back to parsing the SK (`orgId#projectId#oppId`).
  let { orgId, projectId, opportunityId } = o;
  if (!orgId || !projectId || !opportunityId) {
    const parts = (o.sort_key ?? '').split('#');
    if (parts.length >= 3) {
      orgId = orgId ?? parts[0];
      projectId = projectId ?? parts[1];
      opportunityId = opportunityId ?? parts[2];
    }
  }
  if (!orgId || !projectId || !opportunityId) return null;
  return { orgId, projectId, opportunityId };
};

const main = async () => {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : ''}`);
  console.log(`Table: ${TABLE_NAME}  Region: ${REGION}  delete-source: ${DELETE_SOURCE}\n`);

  // 1. Query all PROJECT_OUTCOME records
  const outcomes: OutcomeRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK_NAME },
        ExpressionAttributeValues: { ':pk': PROJECT_OUTCOME_PK },
        ExclusiveStartKey,
      }),
    );
    outcomes.push(...((res.Items ?? []) as OutcomeRecord[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  console.log(`Found ${outcomes.length} PROJECT_OUTCOME record(s).\n`);

  let migrated = 0;
  let orphaned = 0;
  let skipped = 0;
  let deleted = 0;

  for (const o of outcomes) {
    const ids = resolveIds(o);
    if (!ids) {
      console.warn(`⚠️  Skipping malformed outcome SK="${o.sort_key}" (cannot resolve ids)`);
      skipped++;
      continue;
    }
    const { orgId, projectId, opportunityId } = ids;
    const status = mapStatus(o.status);
    if (!status) {
      console.warn(`⚠️  Skipping outcome ${o.sort_key} (no status)`);
      skipped++;
      continue;
    }

    const oppSk = `${orgId}#${projectId}#${opportunityId}`;
    const now = new Date().toISOString();
    const statusDate = o.statusDate ?? now;
    const changedBy = o.statusSetBy ?? 'migration';

    const historyEntry = {
      from: null,
      to: status,
      changedAt: statusDate,
      changedBy,
      reason: 'Migrated from ProjectOutcome',
      source: 'SYSTEM',
    };

    if (DRY_RUN) {
      console.log(`would migrate → OPPORTUNITY ${oppSk}: status=${status}${o.notes ? `, comment="${o.notes.slice(0, 40)}…"` : ''}`);
      migrated++;
      continue;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: oppSk },
          // `status` is a DynamoDB reserved word → alias #status.
          // Only append the migrated history entry once (idempotency via #marker).
          UpdateExpression:
            'SET #status = :status, #outcomeComment = :outcomeComment, #jurisdiction = :jurisdiction, ' +
            '#state = :state, #winData = :winData, #lossData = :lossData, #outcomeDate = :outcomeDate, ' +
            '#outcomeSetBy = :outcomeSetBy, #updatedAt = :now, #marker = :now, ' +
            '#statusHistory = list_append(if_not_exists(#statusHistory, :empty), :history)',
          ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk) AND attribute_not_exists(#marker)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
            '#status': 'status',
            '#outcomeComment': 'outcomeComment',
            '#jurisdiction': 'jurisdiction',
            '#state': 'state',
            '#winData': 'winData',
            '#lossData': 'lossData',
            '#outcomeDate': 'outcomeDate',
            '#outcomeSetBy': 'outcomeSetBy',
            '#updatedAt': 'updatedAt',
            '#statusHistory': 'statusHistory',
            '#marker': 'migratedOutcomeAt',
          },
          ExpressionAttributeValues: {
            ':status': status,
            ':outcomeComment': o.notes ?? null,
            ':jurisdiction': o.jurisdiction ?? null,
            ':state': o.state ?? null,
            ':winData': o.winData ?? null,
            ':lossData': o.lossData ?? null,
            ':outcomeDate': statusDate,
            ':outcomeSetBy': changedBy,
            ':now': now,
            ':history': [historyEntry],
            ':empty': [],
          },
        }),
      );
      console.log(`✅ migrated → OPPORTUNITY ${oppSk} (status=${status})`);
      migrated++;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === 'ConditionalCheckFailedException') {
        // Either the opportunity no longer exists (orphan) or it was already migrated.
        console.warn(`↪️  Skipped ${oppSk} (opportunity missing or already migrated)`);
        orphaned++;
        continue;
      }
      throw err;
    }

    if (DELETE_SOURCE) {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { [PK_NAME]: PROJECT_OUTCOME_PK, [SK_NAME]: o.sort_key },
        }),
      );
      deleted++;
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  migrated:        ${migrated}`);
  console.log(`  orphaned/skipped: ${orphaned + skipped}`);
  if (DELETE_SOURCE) console.log(`  source deleted:  ${deleted}`);
  console.log(DRY_RUN ? '\n(dry run — nothing written)\n' : '\nDone.\n');
};

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
