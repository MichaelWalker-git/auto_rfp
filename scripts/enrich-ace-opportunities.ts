/**
 * One-off enrichment backfill for the 20 ACE (AWS Partner Central) opportunities.
 *
 * The RFP-tracking board records (RFP-table-Dev, PK=OPPORTUNITY,
 * SK=`${orgId}#${projectId}#linear-hor-####`) are thin shells: the 15-minute
 * Linear sync overwrites them with organizationName=null and only the issue body
 * as description. That means the fields we push to Partner Central are hollow —
 * CompanyName resolves to our own org ("HORUSTECH"), Address/BusinessProblem are
 * placeholders, PartnerOpportunityIdentifier is absent.
 *
 * The REAL data lives on the source opportunity record + its executive brief in
 * RFP-table-Test (the production data behind rfp.horustech.dev). This script
 * joins the two via a fixed HOR-id → source-SK map, reads the genuine values
 * (READ-ONLY on the source table), and writes them onto each board record's
 * `aceEnrichment` field — a dedicated field the Linear sync carries forward, so
 * it survives the overwrite. The APN client then merges `aceEnrichment` into the
 * create/advance payload (see helpers/apn-client.ts::buildOpportunityFields).
 *
 * Scope (per product decision):
 *   - customerName            → Customer.Account.CompanyName   (real agency name)
 *   - placeOfPerformance      → Customer.Account.Address       (parsed to City/State/Zip)
 *   - solicitationNumber      → PartnerOpportunityIdentifier
 *   - customerBusinessProblem → Project.CustomerBusinessProblem + OtherSolutionDescription
 *                               (executive-brief summary prose)
 *   Intentionally NOT enriched: ExpectedCustomerSpend (kept as the $1000/mo
 *   placeholder), WebsiteUrl (kept https://unknown.gov), Customer.Contacts (omitted).
 *
 * This script ONLY writes to DynamoDB (the board record's aceEnrichment). It does
 * NOT touch Partner Central — the enriched payload reaches ACE the next time the
 * push path runs (submitted-trigger / submission bot / manual advance).
 *
 * SAFETY:
 *   - Source table (RFP-table-Test) is read with GetItem only — never written.
 *   - Board update is a surgical `SET aceEnrichment` — no other field is touched.
 *   - Dev account only (039885961427). Run under the dev SSO profile.
 *
 * Usage:
 *   eval "$(aws configure export-credentials --profile AdministratorAccess-039885961427 --format env)"
 *   npx tsx scripts/enrich-ace-opportunities.ts \
 *     --board-table RFP-table-Dev --source-table RFP-table-Test \
 *     --org 9c0a5757-e2da-4e71-9490-01c558f7ffc3 --project gov-contracting \
 *     [--region us-east-1] [--dry-run]
 *
 * Recommended: run with --dry-run first to eyeball every enrichment before writing.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

// ─── HOR id → source opportunity SK (org#project#oppId in RFP-table-Test) ─────
// Fixed, hand-verified join. The board record for HOR-#### lives at
// `${ORG}#${PROJECT}#linear-hor-####` (lowercased) in the board table.
const HOR_TO_SOURCE_SK: Record<string, string> = {
  'HOR-2360': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#75339f8d-0e5a-4ee2-8d58-d76860d188b8',
  'HOR-2380': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#3be290f2-c691-4014-91c2-0ecc5a2919f5',
  'HOR-2391': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#238cbf88-dda9-4e74-9aae-621aedba1abe',
  'HOR-2392': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#490223a2-ad21-4a27-85f4-87e94bd889f6',
  'HOR-2436': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#e8fd60e2-8fd5-4fb5-85a8-0ef1899e56e2',
  'HOR-2484': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#fb260383-7858-4dfb-b029-7203099684f5',
  'HOR-2505': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#a476c616-360c-4a8d-afcb-277760ac0a1c',
  'HOR-2509': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#f30ead0e-95a9-4660-811b-c35957633a26',
  'HOR-2538': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#cd494223-453e-4631-8fbc-278e86c5a5b9',
  'HOR-2543': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8bc496b8-de4a-41c7-88ef-6dd599e08fd4#b05b6b30-639b-43e6-8c4b-e52eba29e4b5',
  'HOR-2545': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#01ff031c-1fcc-4f4e-bdb7-516ff63e9760',
  'HOR-2547': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#47edfee1-511f-452d-ac39-f4e3e855d955',
  'HOR-2548': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#88aeb051-aff0-4fad-9600-6b6831451446',
  'HOR-2549': '0e832bda-3489-4932-a9d5-9fa82a86a97a#b86c4f12-edaa-4075-8bb1-9f59afbd9cc8#b54323e3-a003-468c-9042-7062a0780ac9',
  'HOR-2559': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#24a3ad4c-aec6-4248-9be8-369bab8ce26d',
  'HOR-2561': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#7eb139e8-303b-40ed-866e-cb34d8068f1b',
  'HOR-2562': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#5b81b34a-9bea-4a2e-80e5-89fba69f5887',
  'HOR-2579': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#1e2cc5e3-34f8-41ad-8bd3-f3e05be1e2ac',
  'HOR-2581': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#217d53e5-bd63-4fd1-9c7a-f9c4e1fafaa4',
  'HOR-2599': '0e832bda-3489-4932-a9d5-9fa82a86a97a#8eacb458-287f-4ad7-b0bd-09bbd7601903#ad2860bd-0f56-4432-b31f-9d3f34417628',
};

/**
 * Per-id customerName overrides for records whose source `organizationName` is
 * null. Without a name the ACE CompanyName falls back to our own org
 * ("HORUSTECH") — the exact bug this backfill fixes. The value below is derived
 * from the record's own executive-brief prose + place of performance.
 */
const CUSTOMER_NAME_OVERRIDES: Record<string, string> = {
  'HOR-2505': 'City of San Diego',
};

// ─── DynamoDB constants (mirror packages/core + apps/functions constants) ─────
const OPPORTUNITY_PK = 'OPPORTUNITY';
const EXEC_BRIEF_PK = 'EXEC_BRIEF_PK';
const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';

// ─── args ─────────────────────────────────────────────────────────────────────
const getArg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
};

const BOARD_TABLE = getArg('--board-table');
const SOURCE_TABLE = getArg('--source-table');
const ORG_ID = getArg('--org');
const PROJECT_ID = getArg('--project') ?? 'gov-contracting';
const REGION = getArg('--region') ?? 'us-east-1';
const DRY_RUN = process.argv.includes('--dry-run');

if (!BOARD_TABLE || !SOURCE_TABLE || !ORG_ID) {
  console.error(
    'Usage: npx tsx scripts/enrich-ace-opportunities.ts --board-table <t> --source-table <t> --org <orgId> [--project gov-contracting] [--region us-east-1] [--dry-run]',
  );
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// ─── source readers (READ-ONLY on the source table) ──────────────────────────

interface SourceRecord {
  organizationName?: string | null;
  placeOfPerformance?: string | null;
  solicitationNumber?: string | null;
  title?: string | null;
}

const readSourceRecord = async (sourceSk: string): Promise<SourceRecord | null> => {
  const res = await client.send(
    new GetCommand({
      TableName: SOURCE_TABLE,
      Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: sourceSk },
      ProjectionExpression: 'organizationName, placeOfPerformance, solicitationNumber, title',
    }),
  );
  return (res.Item as SourceRecord | undefined) ?? null;
};

/** Exec brief SK is `${projectId}#${opportunityId}` — derived from the source SK. */
const readBriefSummary = async (sourceSk: string): Promise<string | undefined> => {
  const parts = sourceSk.split('#');
  const projectId = parts[1];
  const opportunityId = parts[2];
  if (!projectId || !opportunityId) return undefined;

  const res = await client.send(
    new GetCommand({
      TableName: SOURCE_TABLE,
      Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: `${projectId}#${opportunityId}` },
      ProjectionExpression: 'sections.summary.#d.summary',
      ExpressionAttributeNames: { '#d': 'data' },
    }),
  );

  const summary = res.Item?.sections?.summary?.data?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : undefined;
};

// ─── enrichment builder (mirrors AceEnrichmentSchema in @auto-rfp/core) ───────

interface AceEnrichment {
  customerName?: string;
  placeOfPerformance?: string;
  solicitationNumber?: string;
  customerBusinessProblem?: string;
  enrichedAt?: string;
}

const buildEnrichment = (
  horId: string,
  source: SourceRecord,
  briefSummary: string | undefined,
): AceEnrichment => {
  const enrichment: AceEnrichment = { enrichedAt: new Date().toISOString() };
  // A manual override wins over the (here null) source organizationName.
  const name = CUSTOMER_NAME_OVERRIDES[horId]?.trim() || source.organizationName?.trim();
  const pop = source.placeOfPerformance?.trim();
  const sol = source.solicitationNumber?.trim();
  const problem = briefSummary?.trim();
  if (name) enrichment.customerName = name;
  if (pop) enrichment.placeOfPerformance = pop;
  if (sol) enrichment.solicitationNumber = sol;
  if (problem) enrichment.customerBusinessProblem = problem;
  return enrichment;
};

// ─── main ─────────────────────────────────────────────────────────────────────

const boardSkFor = (horId: string): string =>
  `${ORG_ID}#${PROJECT_ID}#linear-${horId.toLowerCase()}`;

const run = async (): Promise<void> => {
  const entries = Object.entries(HOR_TO_SOURCE_SK);
  console.log(
    `\n${DRY_RUN ? '🔎 DRY RUN' : '✍️  WRITING'} — enriching ${entries.length} ACE opportunities`,
  );
  console.log(`   board:  ${BOARD_TABLE}  (org=${ORG_ID}, project=${PROJECT_ID})`);
  console.log(`   source: ${SOURCE_TABLE}  [READ-ONLY]`);
  console.log(`   region: ${REGION}\n`);

  let enriched = 0;
  let incomplete = 0;
  let missingSource = 0;
  let errors = 0;

  for (const [horId, sourceSk] of entries) {
    try {
      const source = await readSourceRecord(sourceSk);
      if (!source) {
        console.warn(`  ⚠️  ${horId}: source record not found (${sourceSk}) — skipping`);
        missingSource += 1;
        continue;
      }

      const briefSummary = await readBriefSummary(sourceSk);
      const enrichment = buildEnrichment(horId, source, briefSummary);

      // Report field-level completeness so the operator sees exactly what lands.
      const flags = [
        enrichment.customerName ? '[x]name' : '[ ]name',
        enrichment.placeOfPerformance ? '[x]pop' : '[ ]pop',
        enrichment.solicitationNumber ? '[x]sol' : '[ ]sol',
        enrichment.customerBusinessProblem ? '[x]problem' : '[ ]problem',
      ].join(' ');
      if (!enrichment.customerName || !enrichment.customerBusinessProblem) incomplete += 1;

      console.log(`  ${horId}  ${flags}`);
      console.log(`     name:    ${enrichment.customerName ?? '(none)'}`);
      console.log(`     pop:     ${enrichment.placeOfPerformance ?? '(none)'}`);
      console.log(`     sol:     ${enrichment.solicitationNumber ?? '(none)'}`);
      console.log(
        `     problem: ${
          enrichment.customerBusinessProblem
            ? `${enrichment.customerBusinessProblem.slice(0, 120)}…`
            : '(none)'
        }`,
      );

      if (!DRY_RUN) {
        await client.send(
          new UpdateCommand({
            TableName: BOARD_TABLE,
            Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: boardSkFor(horId) },
            // Surgical: only sets aceEnrichment. ConditionExpression guards
            // against creating a phantom item if the board record is missing.
            ConditionExpression: 'attribute_exists(#pk)',
            UpdateExpression: 'SET #ace = :ace',
            ExpressionAttributeNames: { '#pk': PK_NAME, '#ace': 'aceEnrichment' },
            ExpressionAttributeValues: { ':ace': enrichment },
          }),
        );
      }
      enriched += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ConditionalCheckFailed')) {
        console.warn(`  ⚠️  ${horId}: board record ${boardSkFor(horId)} not found — skipping`);
        missingSource += 1;
      } else {
        console.error(`  ❌ ${horId}: ${message}`);
        errors += 1;
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? 'DRY RUN — no writes made.' : 'DONE.'} ` +
      `enriched=${enriched} incomplete=${incomplete} missingSource=${missingSource} errors=${errors}\n`,
  );
};

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
