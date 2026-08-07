/**
 * Sandbox-first CreateOpportunity for the 20 ACE opportunities.
 *
 * The 20 board records (RFP-table-Dev) do NOT exist in Partner Central yet
 * (apnOpportunityId is absent on all of them), so there is nothing to *update* —
 * the enriched data can only reach the ACE portal by CREATING each opportunity.
 * The deployed create path (apn-client.ts::syncToPartnerCentral) hardcodes
 * Catalog='AWS' (production), so this script exists to exercise the SAME payload
 * against the **Sandbox** catalog first, safely, before anything touches prod.
 *
 * For each of the 20 it:
 *   1. reads the board record + its aceEnrichment (honest customer name / place
 *      of performance / solicitation / business-problem prose),
 *   2. builds the full CreateOpportunity payload with the identical field logic
 *      as buildOpportunityFields (address parse, spend placeholder, gov
 *      constants), pinned to Catalog='Sandbox',
 *   3. CreateOpportunity, then SubmitOpportunity (For Visibility Only),
 *   4. writes the returned id back onto the board record under a DISTINCT
 *      `apnSandboxOpportunityId` field — NEVER `apnOpportunityId`, so the
 *      (gated-off) production poller can never mistake a Sandbox id for a real
 *      one.
 *
 * SAFETY:
 *   - Catalog is pinned to 'Sandbox' — no production ('AWS') call is made.
 *   - Source table (RFP-table-Test) is never touched here; enrichment is read
 *     from the board record (RFP-table-Dev) written by the backfill script.
 *   - Idempotent create via ClientToken `${orgId}-${oppId}-sandbox`; a re-run
 *     reattaches rather than duplicates. Skips a record that already has
 *     apnSandboxOpportunityId unless --force.
 *   - Dev account only (039885961427). Run under the dev SSO profile.
 *
 * Usage:
 *   eval "$(aws configure export-credentials --profile AdministratorAccess-039885961427 --format env)"
 *   npx tsx scripts/sandbox-create-ace-opportunities.ts \
 *     --board-table RFP-table-Dev \
 *     --org 9c0a5757-e2da-4e71-9490-01c558f7ffc3 --project gov-contracting \
 *     [--region us-east-1] [--dry-run] [--force] [--only HOR-2360,HOR-2505]
 *
 * Recommended: --dry-run first, then run a single --only HOR-#### to eyeball one
 * opportunity in the Sandbox console before doing all 20.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  PartnerCentralSellingClient,
  CreateOpportunityCommand,
  SubmitOpportunityCommand,
} from '@aws-sdk/client-partnercentral-selling';

// ─── constants (mirror packages/core + apps/functions) ────────────────────────
const OPPORTUNITY_PK = 'OPPORTUNITY';
const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const CATALOG = 'Sandbox' as const; // PINNED — never 'AWS' in this script.
const PLACEHOLDER_MONTHLY_SPEND = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── args ─────────────────────────────────────────────────────────────────────
const getArg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
};

const BOARD_TABLE = getArg('--board-table');
const ORG_ID = getArg('--org');
const PROJECT_ID = getArg('--project') ?? 'gov-contracting';
const REGION = getArg('--region') ?? 'us-east-1';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ONLY = getArg('--only')?.split(',').map((s) => s.trim().toUpperCase()) ?? [];

if (!BOARD_TABLE || !ORG_ID) {
  console.error(
    'Usage: npx tsx scripts/sandbox-create-ace-opportunities.ts --board-table <t> --org <orgId> [--project gov-contracting] [--region us-east-1] [--dry-run] [--force] [--only HOR-2360,...]',
  );
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const apn = new PartnerCentralSellingClient({ region: REGION });

// ─── field builders (replicated from apn-client.ts::buildOpportunityFields) ───

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AS: 'American Samoa', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', GU: 'Guam', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', VI: 'Virgin Islands', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};
const ACE_STATE_NAME_SET = new Set(Object.values(US_STATE_NAMES));
const GOV_ADDRESS = {
  CountryCode: 'US' as const,
  StateOrRegion: 'District of Columbia',
  PostalCode: '20001',
};

const toAceStateName = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (US_STATE_NAMES[upper]) return US_STATE_NAMES[upper];
  return [...ACE_STATE_NAME_SET].find((n) => n.toLowerCase() === trimmed.toLowerCase());
};

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;

const parseUsAddress = (placeOfPerformance: string | null | undefined) => {
  const text = (placeOfPerformance ?? '').trim();
  if (!text) return GOV_ADDRESS;
  const zip = text.match(ZIP_RE)?.[1];
  const withoutZip = zip ? text.replace(ZIP_RE, '').trim() : text;
  const parts = withoutZip.split(',').map((p) => p.trim()).filter(Boolean);
  let city: string | undefined;
  let state: string | undefined;
  if (parts.length >= 2) {
    state = toAceStateName(parts[parts.length - 1]!);
    city = parts[parts.length - 2];
  } else if (parts.length === 1) {
    const asState = toAceStateName(parts[0]!);
    if (asState) state = asState;
    else city = parts[0];
  }
  const address: { CountryCode: 'US'; City?: string; StateOrRegion?: string; PostalCode?: string } = {
    CountryCode: 'US',
  };
  if (city) address.City = city;
  if (state) address.StateOrRegion = state;
  if (zip) address.PostalCode = zip;
  if (!address.StateOrRegion && !address.PostalCode) return GOV_ADDRESS;
  return address;
};

const toBusinessProblem = (description: string | undefined, title: string): string => {
  const body = (description ?? '').trim();
  if (body.length >= 20) return body.slice(0, 2000);
  return `Government contracting opportunity: ${title}`.slice(0, 2000);
};

const toFutureCloseDate = (iso: string | undefined): string => {
  const parsed = iso ? Date.parse(iso) : NaN;
  const today = Date.now();
  const effective = !Number.isNaN(parsed) && parsed > today ? parsed : today + 30 * DAY_MS;
  return new Date(effective).toISOString().split('T')[0];
};

// ─── board record shape (only the fields we read) ─────────────────────────────
interface AceEnrichment {
  customerName?: string;
  placeOfPerformance?: string;
  solicitationNumber?: string;
  customerBusinessProblem?: string;
}
interface BoardRecord {
  oppId: string;
  title?: string;
  description?: string;
  responseDeadlineIso?: string;
  baseAndAllOptionsValue?: number | null;
  organizationName?: string | null;
  apnSandboxOpportunityId?: string;
  aceEnrichment?: AceEnrichment;
  noticeId?: string;
}

const boardSkFor = (horId: string): string =>
  `${ORG_ID}#${PROJECT_ID}#linear-${horId.toLowerCase()}`;

/** Read every linear-hor board record for this org/project. */
const readBoardRecords = async (): Promise<Array<{ horId: string; rec: BoardRecord; sk: string }>> => {
  const out: Array<{ horId: string; rec: BoardRecord; sk: string }> = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: BOARD_TABLE,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': OPPORTUNITY_PK,
          ':prefix': `${ORG_ID}#${PROJECT_ID}#linear-hor-`,
        },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const sk = item[SK_NAME] as string;
      const horId = (item.noticeId as string | undefined) ?? sk.split('linear-')[1]?.toUpperCase();
      out.push({ horId: horId.toUpperCase(), rec: item as BoardRecord, sk });
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
};

const buildPayload = (rec: BoardRecord) => {
  const enr = rec.aceEnrichment;
  const customerName = enr?.customerName?.trim() || rec.organizationName?.trim() || 'Unknown Customer';
  const title = rec.title || customerName;
  const businessProblem = enr?.customerBusinessProblem?.trim()
    ? enr.customerBusinessProblem.trim().slice(0, 2000)
    : toBusinessProblem(rec.description, title);
  const address = enr?.placeOfPerformance ? parseUsAddress(enr.placeOfPerformance) : GOV_ADDRESS;
  const partnerOpportunityIdentifier = enr?.solicitationNumber?.trim() || undefined;
  const value = typeof rec.baseAndAllOptionsValue === 'number' && rec.baseAndAllOptionsValue > 0
    ? Math.round(rec.baseAndAllOptionsValue)
    : PLACEHOLDER_MONTHLY_SPEND;

  return {
    Catalog: CATALOG,
    Customer: {
      Account: {
        CompanyName: customerName,
        Industry: 'Government' as const,
        WebsiteUrl: 'https://unknown.gov',
        Address: address,
      },
    },
    Project: {
      Title: title,
      CustomerBusinessProblem: businessProblem,
      CustomerUseCase: 'Business Applications & Contact Center' as const,
      DeliveryModels: ['SaaS or PaaS' as const],
      // ACE caps OtherSolutionDescription at 255 chars (CustomerBusinessProblem
      // allows ~2000). Truncate independently so the full problem prose still
      // lands on the un-capped field.
      OtherSolutionDescription: businessProblem.slice(0, 255),
      ExpectedCustomerSpend: [{
        Amount: String(value),
        CurrencyCode: 'USD' as const,
        Frequency: 'Monthly' as const,
        TargetCompany: 'AWS',
      }],
    },
    Marketing: { Source: 'None' as const, AwsFundingUsed: 'No' as const },
    OpportunityType: 'Net New Business' as const,
    PrimaryNeedsFromAws: ['Co-Sell - Support for Public Tender / RFx' as const],
    LifeCycle: {
      Stage: 'Prospect' as const,
      TargetCloseDate: toFutureCloseDate(rec.responseDeadlineIso),
    },
    ...(partnerOpportunityIdentifier ? { PartnerOpportunityIdentifier: partnerOpportunityIdentifier } : {}),
  };
};

const run = async (): Promise<void> => {
  console.log(
    `\n${DRY_RUN ? '🔎 DRY RUN' : '✍️  CREATING'} in Partner Central catalog='${CATALOG}'  (region=${REGION})`,
  );
  console.log(`   board: ${BOARD_TABLE}  (org=${ORG_ID}, project=${PROJECT_ID})`);
  if (ONLY.length) console.log(`   only:  ${ONLY.join(', ')}`);
  console.log();

  const all = await readBoardRecords();
  // Only create for records that carry honest enrichment — that set is exactly
  // the backfilled 20. Un-enriched board shells (Unknown Customer / placeholder
  // address) must NOT be pushed to Partner Central.
  const enriched = all.filter((r) => r.rec.aceEnrichment?.customerName?.trim());
  const targets = ONLY.length ? enriched.filter((r) => ONLY.includes(r.horId)) : enriched;
  console.log(`   ${all.length} board records; ${enriched.length} enriched; targeting ${targets.length}\n`);

  let created = 0, submitted = 0, skipped = 0, errors = 0;

  for (const { horId, rec, sk } of targets) {
    try {
      if (rec.apnSandboxOpportunityId && !FORCE) {
        console.log(`  ⏭️  ${horId}: already has apnSandboxOpportunityId=${rec.apnSandboxOpportunityId} (use --force to recreate)`);
        skipped += 1;
        continue;
      }

      const payload = buildPayload(rec);
      console.log(`  ${horId}: ${payload.Customer.Account.CompanyName}  |  "${payload.Project.Title.slice(0, 50)}"`);
      console.log(`     addr: ${JSON.stringify(payload.Customer.Account.Address)}  sol: ${(payload as { PartnerOpportunityIdentifier?: string }).PartnerOpportunityIdentifier ?? '(none)'}`);

      if (DRY_RUN) { created += 1; continue; }

      const createRes = await apn.send(
        new CreateOpportunityCommand({ ...payload, ClientToken: `${ORG_ID}-${rec.oppId}-sandbox` }),
      );
      const id = createRes.Id ?? '';
      console.log(`     ✅ created ${id}`);
      created += 1;

      await ddb.send(
        new UpdateCommand({
          TableName: BOARD_TABLE,
          Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: sk },
          ConditionExpression: 'attribute_exists(#pk)',
          UpdateExpression: 'SET #sbx = :sbx',
          ExpressionAttributeNames: { '#pk': PK_NAME, '#sbx': 'apnSandboxOpportunityId' },
          ExpressionAttributeValues: { ':sbx': id },
        }),
      );

      try {
        await apn.send(new SubmitOpportunityCommand({
          Catalog: CATALOG,
          Identifier: id,
          InvolvementType: 'For Visibility Only',
        }));
        console.log(`     ✅ submitted for review`);
        submitted += 1;
      } catch (submitErr) {
        const m = submitErr instanceof Error ? submitErr.message : String(submitErr);
        console.warn(`     ⚠️  submit failed (non-blocking): ${m}`);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${horId}: ${m}`);
      errors += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? 'DRY RUN — no writes made.' : 'DONE.'} ` +
      `created=${created} submitted=${submitted} skipped=${skipped} errors=${errors}\n`,
  );
};

run().catch((err) => { console.error('Fatal:', err); process.exit(1); });
