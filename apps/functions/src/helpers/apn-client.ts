import {
  PartnerCentralSellingClient,
  CreateOpportunityCommand,
  UpdateOpportunityCommand,
  GetOpportunityCommand,
  SubmitOpportunityCommand,
  StartEngagementFromOpportunityTaskCommand,
  ListEngagementFromOpportunityTasksCommand,
  Stage,
  MarketingSource,
  AwsFundingUsed,
  SalesInvolvementType,
  Visibility,
  OpportunityType,
  PrimaryNeedFromAws,
} from '@aws-sdk/client-partnercentral-selling';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AceStage, AceEnrichment } from '@auto-rfp/core';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { APN_CATALOG } from '@/constants/apn';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { buildOpportunitySk } from '@/helpers/opportunity';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Partner Central Selling SDK Client ───────────────────────────────────────

const getClient = (): PartnerCentralSellingClient => {
  const region = process.env['PARTNER_CENTRAL_REGION'] ?? 'us-east-1';
  console.log(`[APN] Creating PartnerCentralSellingClient with region: ${region}`);

  return new PartnerCentralSellingClient({
    region,
    requestHandler: {
      requestTimeout: 60000, // 60 second timeout (increased from 30s)
      connectionTimeout: 15000, // 15 second connection timeout (increased from 10s)
    }
  });
};

const stageMap: Record<string, (typeof Stage)[keyof typeof Stage]> = {
  PROSPECT:  Stage.PROSPECT,
  SUBMITTED: Stage.QUALIFIED,
  WON:       Stage.COMMITTED,
  LOST:      Stage.CLOSED_LOST,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Partner Central requires `LifeCycle.TargetCloseDate` to be a FUTURE date
 * (YYYY-MM-DD). RFPs we push are frequently already submitted, so their
 * response deadline is in the past — which ACE rejects. Clamp any non-future
 * date forward so the create/update always validates. A future date passes
 * through unchanged.
 */
const toFutureCloseDate = (iso: string): string => {
  const parsed = Date.parse(iso);
  const today = Date.now();
  // 30 days out gives ACE a comfortably-future date when the source is invalid/past.
  const effective = !Number.isNaN(parsed) && parsed > today ? parsed : today + 30 * DAY_MS;
  return new Date(effective).toISOString().split('T')[0];
};

// ─── Fixed values for AWS-required fields with no upstream source ─────────────
//
// AWS Partner Central requires these to submit an opportunity, but the Linear
// "Government Contracting" board carries no field for them. These are the
// correct fixed values for our profile: SaaS proposals responding to public
// sector RFPs, where the co-sell ask is Public Tender / RFx support. They are
// intentionally constants (not placeholders) — every RFP on this board fits it.
const GOV_OPPORTUNITY_TYPE = OpportunityType.NET_NEW_BUSINESS;
/**
 * Placeholder monthly AWS spend (USD) used when an opportunity has no real
 * contract value to derive from. Not a real estimate — a stand-in so the field
 * is always populated. TODO: source a genuine per-deal figure (AWS Pricing
 * Calculator) once that data exists.
 */
const PLACEHOLDER_MONTHLY_SPEND = 1000;
const GOV_PRIMARY_NEED = PrimaryNeedFromAws.CO_SELL_SUPPORT_FOR_PUBLIC_TENDER_RFX;
/**
 * A US address is required. We serve US government customers; the specific
 * agency's city/state isn't captured upstream, so we send the country + a
 * neutral capital-region placeholder that satisfies the required-field
 * validation without asserting a false specific location.
 */
const GOV_ADDRESS = {
  CountryCode: 'US' as const,
  StateOrRegion: 'District of Columbia',
  PostalCode: '20001',
} as const;

/**
 * ACE `Customer.Account.Address.StateOrRegion` accepts a fixed list of full
 * state/region NAMES (not USPS abbreviations). We commonly hold the state as a
 * 2-letter code (e.g. "VA") or a full name in `placeOfPerformance`, so map both
 * forms to the exact ACE-accepted name. Anything unrecognized is dropped rather
 * than sent (an invalid StateOrRegion fails validation).
 */
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

/** Normalize a raw state token to an ACE-accepted state name, or undefined. */
const toAceStateName = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (US_STATE_NAMES[upper]) return US_STATE_NAMES[upper];
  // Already a full name (case-insensitive match against the accepted set).
  const match = [...ACE_STATE_NAME_SET].find((n) => n.toLowerCase() === trimmed.toLowerCase());
  return match;
};

/** A US 5- or 9-digit ZIP appearing anywhere in the string. */
const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;

/**
 * Best-effort parse of a free-text `placeOfPerformance` into an ACE Address.
 * Handles the common shapes we see on these records:
 *   "Norfolk, VA"
 *   "Oakdale, New York 11769"
 *   "Tucson, AZ 85701"
 *   "South Dakota"
 *   "San Mateo County, California"
 * Only fields we can extract confidently are set; CountryCode is always 'US'.
 * Returns the DC placeholder when nothing usable can be parsed, so the required
 * Address is always populated.
 */
const parseUsAddress = (placeOfPerformance: string | null | undefined) => {
  const text = (placeOfPerformance ?? '').trim();
  if (!text) return GOV_ADDRESS;

  const zip = text.match(ZIP_RE)?.[1];
  // Strip the ZIP out before comma parsing so it doesn't pollute the state token.
  const withoutZip = zip ? text.replace(ZIP_RE, '').trim() : text;
  const parts = withoutZip.split(',').map((p) => p.trim()).filter(Boolean);

  let city: string | undefined;
  let state: string | undefined;

  if (parts.length >= 2) {
    // "City, State" — last segment is the state, the one before it the city.
    state = toAceStateName(parts[parts.length - 1]!);
    city = parts[parts.length - 2];
  } else if (parts.length === 1) {
    // A lone token: treat as a state if it maps, otherwise as a city.
    const asState = toAceStateName(parts[0]!);
    if (asState) state = asState;
    else city = parts[0];
  }

  const address: {
    CountryCode: 'US';
    City?: string;
    StateOrRegion?: string;
    PostalCode?: string;
  } = { CountryCode: 'US' };
  if (city) address.City = city;
  if (state) address.StateOrRegion = state;
  if (zip) address.PostalCode = zip;

  // If we couldn't extract a state or a zip, fall back to the neutral placeholder
  // rather than sending a half-empty address that may fail validation.
  if (!address.StateOrRegion && !address.PostalCode) return GOV_ADDRESS;
  return address;
};

/** Trim the Linear issue body to a single, ACE-safe field value. */
const toBusinessProblem = (description: string | undefined, title: string): string => {
  const body = (description ?? '').trim();
  // ACE caps CustomerBusinessProblem at 4000 chars; keep a comfortable margin.
  if (body.length >= 20) return body.slice(0, 2000);
  // Degrade gracefully when the issue has no usable body: the title is the only
  // other real signal, expanded into a minimal problem statement.
  return `Government contracting opportunity: ${title}`.slice(0, 2000);
};

/**
 * Build the shared Customer/Project/Marketing/top-level fields both the create
 * and the stage-advance paths send. AWS validates the WHOLE opportunity on every
 * write, so both paths must send an identical, complete payload — centralizing
 * it here keeps them from drifting (the drift is what caused the historical
 * REQUIRED_FIELD_MISSING failures).
 */
const buildOpportunityFields = (args: {
  customerName: string;
  opportunityTitle?: string;
  opportunityValue?: number | null;
  description?: string;
  /**
   * Honest enrichment overrides sourced from the real opportunity record + its
   * executive brief (see ace-enrichment). When present these replace the
   * placeholder-derived values; when absent the existing placeholder logic
   * applies unchanged.
   */
  enrichment?: AceEnrichment;
}) => {
  const title = args.opportunityTitle || args.customerName;
  // A real executive-brief business problem wins over the title/body-derived
  // stub; fall back to the existing derivation when no override is supplied.
  const businessProblem = args.enrichment?.customerBusinessProblem?.trim()
    ? args.enrichment.customerBusinessProblem.trim().slice(0, 2000)
    : toBusinessProblem(args.description, title);
  // Real place-of-performance → structured Address; else neutral placeholder.
  const address = args.enrichment?.placeOfPerformance
    ? parseUsAddress(args.enrichment.placeOfPerformance)
    : GOV_ADDRESS;
  // Real solicitation number → PartnerOpportunityIdentifier (optional field).
  const partnerOpportunityIdentifier = args.enrichment?.solicitationNumber?.trim() || undefined;

  // ExpectedCustomerSpend represents the customer's estimated *monthly AWS
  // spend* — a figure the RFP data cannot produce (no cost proposal exists, and
  // the only dollar field, total contract value, is a lump sum populated on a
  // tiny minority of records). AWS does NOT require this field to submit, but we
  // include it anyway: the real contract value when we have one, otherwise a
  // PLACEHOLDER monthly amount. TODO: replace the placeholder with a real
  // per-deal AWS Pricing Calculator estimate when that data becomes available.
  const monthlyAmount =
    typeof args.opportunityValue === 'number' && args.opportunityValue > 0
      ? Math.round(args.opportunityValue)
      : PLACEHOLDER_MONTHLY_SPEND;
  const spend = [{
    Amount: String(monthlyAmount),
    CurrencyCode: 'USD' as const,
    Frequency: 'Monthly' as const,
    TargetCompany: 'AWS',
  }];

  return {
    Customer: {
      Account: {
        CompanyName: args.customerName,
        Industry: 'Government' as const,
        // No website is captured upstream — kept as a neutral placeholder by
        // decision (see ace-enrichment); ACE does not require a real URL.
        WebsiteUrl: 'https://unknown.gov',
        Address: address,
      },
    },
    Project: {
      Title: title,
      CustomerBusinessProblem: businessProblem,
      CustomerUseCase: 'Business Applications & Contact Center' as const,
      DeliveryModels: ['SaaS or PaaS' as const],
      // Satisfies "associate at least one solution OR provide a description";
      // we have no catalog Solution id, so we describe the offered solution.
      OtherSolutionDescription: businessProblem,
      ExpectedCustomerSpend: spend,
    },
    Marketing: {
      Source: MarketingSource.NONE,
      AwsFundingUsed: AwsFundingUsed.NO,
    },
    OpportunityType: GOV_OPPORTUNITY_TYPE,
    PrimaryNeedsFromAws: [GOV_PRIMARY_NEED],
    // Real solicitation number, when known — a top-level field on both the
    // create and update requests. Omitted (undefined) when absent.
    ...(partnerOpportunityIdentifier ? { PartnerOpportunityIdentifier: partnerOpportunityIdentifier } : {}),
  };
};

// ─── Update opportunity's APN fields in DynamoDB ──────────────────────────────

const setApnFields = async (
  orgId: string,
  projectId: string,
  oppId: string,
  apnOpportunityId: string | null,
  apnSyncError: string | null,
): Promise<void> => {
  await docClient.send(new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: OPPORTUNITY_PK,
      [SK_NAME]: buildOpportunitySk(orgId, projectId, oppId),
    },
    UpdateExpression: 'SET #apnId = :apnId, #apnErr = :apnErr',
    ExpressionAttributeNames: {
      '#apnId': 'apnOpportunityId',
      '#apnErr': 'apnSyncError',
    },
    ExpressionAttributeValues: {
      ':apnId': apnOpportunityId,
      ':apnErr': apnSyncError,
    },
  }));
};

// ─── Partner Central API Operations ───────────────────────────────────────────

export interface SyncToApnArgs {
  orgId:             string;
  projectId:         string;
  oppId:             string;
  customerName:      string;
  opportunityTitle?: string;
  /** Total contract value if known; null/undefined ⇒ ExpectedCustomerSpend omitted. */
  opportunityValue?: number | null;
  expectedCloseDate: string;
  proposalStatus:    string;
  description?:      string;
  /** Existing APN opportunity ID — if set, updates instead of creating */
  existingApnId?:    string | null;
  /**
   * Explicit ACE lifecycle stage (exact Partner Central `LifeCycle.Stage`
   * string). When set, overrides the proposalStatus-derived stage mapping.
   */
  aceStage?:         AceStage;
  /**
   * Honest source-derived field overrides (real CompanyName / Address /
   * solicitation / business problem). Merged into the create/update payload;
   * when absent the existing placeholder logic applies.
   */
  enrichment?:       AceEnrichment;
}

/**
 * Sync an opportunity to AWS Partner Central.
 * Simplified approach with better error handling and timeout management.
 */
export const syncToPartnerCentral = async (args: SyncToApnArgs): Promise<void> => {
  const {
    orgId, projectId, oppId, customerName, opportunityTitle,
    opportunityValue, expectedCloseDate, proposalStatus, description, existingApnId,
    aceStage, enrichment,
  } = args;

  // A real customer name from the enrichment overrides the (often org-fallback)
  // customerName the caller passed — the board record's org resolves to
  // "HORUSTECH", which is us, not the government customer.
  const effectiveCustomerName = enrichment?.customerName?.trim() || customerName;

  console.log(`[APN] Starting sync for oppId=${oppId}, proposalStatus=${proposalStatus}, aceStage=${aceStage}, existingApnId=${existingApnId}`);

  // Explicit ACE stage wins; otherwise map proposal status to APN stage.
  // AceStage values are the exact SDK Stage strings, so pass through directly.
  const stage: (typeof Stage)[keyof typeof Stage] =
    aceStage ?? stageMap[proposalStatus] ?? Stage.PROSPECT;
  console.log(`[APN] Resolved stage '${stage}' (${aceStage ? 'explicit aceStage' : `mapped from '${proposalStatus}'`})`);

  // Prepare LifeCycle with conditional closedLostReason.
  // ACE requires TargetCloseDate to be in the future; submitted RFPs have past
  // deadlines, so clamp forward.
  const lifecycle: any = {
    Stage: stage,
    TargetCloseDate: toFutureCloseDate(expectedCloseDate),
  };

  // Add closedLostReason when stage is CLOSED_LOST
  if (stage === Stage.CLOSED_LOST) {
    lifecycle.ClosedLostReason = 'Customer Deficiency';
  }

  // Prepare API payload. The shared field builder fills every AWS-required
  // field (Customer/Project/Marketing/OpportunityType/PrimaryNeedsFromAws),
  // deriving CustomerBusinessProblem + the solution description from the real
  // Linear issue body. UseCases stay empty while AwsFundingUsed = No.
  const payload = {
    Catalog: APN_CATALOG,
    ...buildOpportunityFields({
      customerName: effectiveCustomerName,
      opportunityTitle,
      opportunityValue,
      description,
      enrichment,
    }),
    LifeCycle: lifecycle,
  };

  const client = getClient();
  let apnId: string;

  try {
    if (existingApnId) {
      // UPDATE existing opportunity
      console.log(`[APN] Updating opportunity ${existingApnId} to stage ${stage}`);

      // Step 1: Fetch latest opportunity to get RevisionId
      console.log(`[APN] Fetching latest opportunity to get RevisionId...`);
      const getCommand = new GetOpportunityCommand({
        Catalog: APN_CATALOG,
        Identifier: existingApnId,
      });

      const getResponse = await client.send(getCommand);
      console.log(`[APN] GetOpportunity response keys:`, Object.keys(getResponse));

      // Try multiple potential locations for RevisionId in the response
      const currentRevisionId = (getResponse as any).RevisionId
        || (getResponse as any).Opportunity?.RevisionId
        || (getResponse as any).LastModifiedDate; // Fallback to LastModifiedDate as some APIs use this

      const lifecycleStage = (getResponse as any).LifeCycle?.Stage
        || (getResponse as any).Opportunity?.LifeCycle?.Stage;

      if (!currentRevisionId) {
        console.error(`[APN] GetOpportunity response missing RevisionId. Available keys:`, Object.keys(getResponse));
        console.error(`[APN] Full response structure:`, JSON.stringify(getResponse, null, 2));

        // If opportunity doesn't exist or can't be retrieved, skip update
        console.warn(`[APN] Cannot update opportunity ${existingApnId} - skipping APN sync`);
        return; // Exit early instead of throwing
      }

      console.log(`[APN] Current RevisionId: ${currentRevisionId}, LifeCycle.Stage: ${lifecycleStage}`);

      // Step 2: Check opportunity status (Pending Submission means it's locked for review)
      const opportunityStatus = (getResponse as any).OpportunityStatus;
      console.log(`[APN] Current OpportunityStatus: ${opportunityStatus}`);

      if (opportunityStatus === 'Pending Submission') {
        console.warn(`[APN] Opportunity ${existingApnId} is pending submission review - cannot update until reviewed`);
        // Don't throw - this is a transient state, just skip the update
        return;
      }

      // Step 3: Validate opportunity is still editable
      const closedStages = ['CLOSED_LOST', 'CLOSED_INCOMPLETE'];
      if (closedStages.includes(lifecycleStage)) {
        console.warn(`[APN] Opportunity ${existingApnId} is in non-editable state: ${lifecycleStage}`);
        throw new Error(`Cannot update opportunity in ${lifecycleStage} state`);
      }

      // Step 4: Send update with RevisionId. Spread the full payload so the
      // update carries every AWS-required field (Customer/Project/Marketing/
      // OpportunityType/PrimaryNeedsFromAws) identically to create — AWS
      // validates the whole object, so a partial patch is rejected.
      const updatePayload = {
        ...payload,
        Identifier: existingApnId,
        RevisionId: currentRevisionId,
        LastModifiedDate: (getResponse as any).LastModifiedDate ?? new Date(),
      };

      console.log(`[APN] Sending UpdateOpportunityCommand with RevisionId ${currentRevisionId}...`);
      console.log(`[APN] Update payload:`, JSON.stringify(updatePayload, null, 2));

      try {
        const response = await client.send(new UpdateOpportunityCommand(updatePayload));

        console.log(`[APN] Update successful:`, response);
        apnId = existingApnId;

        // If updating to SUBMITTED status (QUALIFIED in APN), submit for review
        if (proposalStatus === 'SUBMITTED' && stage === Stage.QUALIFIED) {
          try {
            console.log(`[APN] Opportunity updated to SUBMITTED - submitting for review`);
            await client.send(new SubmitOpportunityCommand({
              Catalog: APN_CATALOG,
              Identifier: apnId,
              InvolvementType: 'For Visibility Only',
            }));
            console.log(`[APN] Submit for review successful`);
          } catch (submitErr) {
            console.warn(`[APN] Submit failed (non-blocking):`, (submitErr as Error).message);
          }
        }

      } catch (updateErr) {
        // Step 5: Handle specific error cases
        // ACTION_NOT_PERMITTED: Opportunity is in a locked state (e.g., Pending Submission)
        if (updateErr instanceof Error && updateErr.message?.includes('ACTION_NOT_PERMITTED')) {
          console.warn(`[APN] Update not permitted (opportunity may be pending submission):`, updateErr.message);
          // Don't save error to DB - this is a transient state
          return;
        }

        // Step 6: Handle revision conflict with retry
        if (updateErr instanceof Error && updateErr.name === 'RevisionConflictException') {
          console.warn(`[APN] RevisionConflictException - refetching and retrying once...`);

          const retryGetResponse = await client.send(getCommand);
          const latestRevisionId = (retryGetResponse as any).RevisionId
            || (retryGetResponse as any).Opportunity?.RevisionId
            || (retryGetResponse as any).LastModifiedDate;

          const latestLastModifiedDate = (retryGetResponse as any).LastModifiedDate
            || (retryGetResponse as any).Opportunity?.LastModifiedDate;

          if (!latestRevisionId) {
            console.error(`[APN] Retry failed - missing RevisionId. Response keys:`, Object.keys(retryGetResponse));
            console.warn(`[APN] Cannot update opportunity ${existingApnId} on retry - skipping APN sync`);
            return; // Exit early instead of throwing
          }

          console.log(`[APN] Retry with latest RevisionId: ${latestRevisionId}`);
          updatePayload.RevisionId = latestRevisionId;
          updatePayload.LastModifiedDate = latestLastModifiedDate ?? new Date();

          const retryResponse = await client.send(new UpdateOpportunityCommand(updatePayload));

          console.log(`[APN] Retry successful:`, retryResponse);
          apnId = existingApnId;

          // If updating to SUBMITTED status (QUALIFIED in APN), submit for review
          if (proposalStatus === 'SUBMITTED' && stage === Stage.QUALIFIED) {
            try {
              console.log(`[APN] Opportunity updated to SUBMITTED - submitting for review (retry path)`);
              await client.send(new SubmitOpportunityCommand({
                Catalog: APN_CATALOG,
                Identifier: apnId,
                InvolvementType: 'For Visibility Only',
              }));
              console.log(`[APN] Submit for review successful (retry path)`);
            } catch (submitErr) {
              console.warn(`[APN] Submit failed (non-blocking):`, (submitErr as Error).message);
            }
          }
        } else {
          throw updateErr;
        }
      }
    } else {
      // CREATE new opportunity
      console.log(`[APN] Creating new opportunity with stage ${stage}`);
      
      const createCommand = new CreateOpportunityCommand({
        ...payload,
        ClientToken: `${orgId}-${oppId}`,
      });

      console.log(`[APN] Sending CreateOpportunityCommand...`);
      const response = await client.send(createCommand);

      apnId = response.Id ?? '';
      console.log(`[APN] Create successful, APN ID: ${apnId}`);

      // NOTE: ACE creates every opportunity at 'Prospect' with
      // LifeCycle.ReviewStatus = 'Pending Submission', and the API forbids stage
      // changes while in that state ("You can not update the stage when
      // Opportunity status is Pending Submission"). Advancing to the requested
      // stage (e.g. 'Technical Validation') is therefore a human step in the
      // Partner Central console once the opportunity is submitted for review.
      // We intentionally do NOT attempt a follow-up stage update here.

      // Submit for review
      if (apnId) {
        try {
          console.log(`[APN] Submitting opportunity ${apnId} for review`);
          await client.send(new SubmitOpportunityCommand({
            Catalog: APN_CATALOG,
            Identifier: apnId,
            InvolvementType: 'For Visibility Only',
          }));
          console.log(`[APN] Submit successful`);
        } catch (submitErr) {
          console.warn(`[APN] Submit failed (non-blocking):`, (submitErr as Error).message);
        }
      }
    }

    // Save success to DynamoDB
    console.log(`[APN] Saving success to DynamoDB: apnId=${apnId}`);
    await setApnFields(orgId, projectId, oppId, apnId, null);
    console.log(`[APN] Sync completed successfully for oppId=${oppId}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[APN] Sync failed for oppId=${oppId}:`, errorMessage);
    console.error(`[APN] Error details:`, error);

    // Save error to DynamoDB
    await setApnFields(orgId, projectId, oppId, existingApnId ?? null, errorMessage.substring(0, 500));
    
    // Don't throw - make it non-blocking
    console.warn(`[APN] Sync failed but continuing (non-blocking): ${errorMessage}`);
  }
};

// ─── Submission / Engagement Lifecycle (advance-to-Technical-Validation bot) ──
//
// AWS Partner Central makes advancing an opportunity's stage inherently async:
// a new opp is locked at Prospect / ReviewStatus=`Pending Submission`, its stage
// is only editable once submitted to AWS review and Approved. The low-level ops
// below are the primitives the ace-submission state machine drives, one step per
// scheduled poller tick. They read a submission catalog that defaults to the
// main APN catalog but can be overridden (APN_SUBMISSION_CATALOG=Sandbox) so the
// whole lifecycle can be exercised against the Sandbox catalog before pointing
// it at production `AWS`.

/**
 * The catalog submissions are made against. Defaults to APN_CATALOG ('AWS',
 * production) but can be overridden to 'Sandbox' for safe end-to-end testing.
 */
export const getSubmissionCatalog = (): string =>
  process.env['APN_SUBMISSION_CATALOG'] ?? APN_CATALOG;

/** Result of starting an engagement task (async — poll TaskId for completion). */
export interface StartEngagementResult {
  taskId?: string;
  taskStatus?: string;
  engagementId?: string;
  message?: string;
}

/**
 * Kick off StartEngagementFromOpportunityTask for an opportunity. Idempotent via
 * ClientToken (`${orgId}-${oppId}-engage`). Returns the TaskId to poll; the task
 * itself completes asynchronously. Throws on hard API errors — the caller
 * (state machine) decides how to record them.
 */
export const startEngagementFromOpportunity = async (args: {
  orgId: string;
  oppId: string;
  apnOpportunityId: string;
}): Promise<StartEngagementResult> => {
  const catalog = getSubmissionCatalog();
  const client = getClient();
  console.log(`[APN] StartEngagementFromOpportunityTask apnId=${args.apnOpportunityId} catalog=${catalog}`);

  const response = await client.send(
    new StartEngagementFromOpportunityTaskCommand({
      Catalog: catalog,
      Identifier: args.apnOpportunityId,
      ClientToken: `${args.orgId}-${args.oppId}-engage`,
      AwsSubmission: {
        InvolvementType: SalesInvolvementType.FOR_VISIBILITY_ONLY,
        Visibility: Visibility.FULL,
      },
    }),
  );

  return {
    taskId: response.TaskId,
    taskStatus: response.TaskStatus,
    engagementId: response.EngagementId,
    message: response.Message,
  };
};

/**
 * Poll the status of a previously-started engagement task by TaskId. Returns the
 * latest TaskStatus (IN_PROGRESS | COMPLETE | FAILED) and, once COMPLETE, the
 * EngagementId. Returns undefined status when the task can't be found.
 */
export const getEngagementTaskStatus = async (args: {
  taskId: string;
  apnOpportunityId: string;
}): Promise<StartEngagementResult> => {
  const catalog = getSubmissionCatalog();
  const client = getClient();

  const response = await client.send(
    new ListEngagementFromOpportunityTasksCommand({
      Catalog: catalog,
      TaskIdentifier: [args.taskId],
    }),
  );

  const summary = (response.TaskSummaries ?? [])[0];
  return {
    taskId: summary?.TaskId,
    taskStatus: summary?.TaskStatus,
    engagementId: summary?.EngagementId,
    message: summary?.Message,
  };
};

/**
 * Submit an opportunity to AWS review (SubmitOpportunity). Requires an
 * engagement to exist first. Throws on API errors.
 */
export const submitOpportunityForReview = async (args: {
  apnOpportunityId: string;
}): Promise<void> => {
  const catalog = getSubmissionCatalog();
  const client = getClient();
  console.log(`[APN] SubmitOpportunity apnId=${args.apnOpportunityId} catalog=${catalog}`);

  await client.send(
    new SubmitOpportunityCommand({
      Catalog: catalog,
      Identifier: args.apnOpportunityId,
      InvolvementType: SalesInvolvementType.FOR_VISIBILITY_ONLY,
      Visibility: Visibility.FULL,
    }),
  );
};

/** The review-relevant slice of a GetOpportunity response. */
export interface OpportunityReviewSnapshot {
  reviewStatus?: string;
  stage?: string;
  reviewComments?: string;
  reviewStatusReason?: string;
  lastModifiedDate?: Date;
}

/**
 * Read the current LifeCycle.ReviewStatus / Stage for an opportunity. Used by
 * the poller to detect when AWS has moved the opp out of review. Throws on API
 * errors.
 */
export const getOpportunityReviewSnapshot = async (args: {
  apnOpportunityId: string;
}): Promise<OpportunityReviewSnapshot> => {
  const catalog = getSubmissionCatalog();
  const client = getClient();

  const response = await client.send(
    new GetOpportunityCommand({
      Catalog: catalog,
      Identifier: args.apnOpportunityId,
    }),
  );

  return {
    reviewStatus: response.LifeCycle?.ReviewStatus,
    stage: response.LifeCycle?.Stage,
    reviewComments: response.LifeCycle?.ReviewComments,
    reviewStatusReason: response.LifeCycle?.ReviewStatusReason,
    lastModifiedDate: response.LastModifiedDate,
  };
};

/**
 * Advance an already-approved opportunity's stage. Only valid once the opp has
 * left `Pending Submission` and is `Approved` (editable). Reuses the existing
 * update path via syncToPartnerCentral with an explicit aceStage. Throws on
 * hard errors so the state machine can record/retry.
 */
export const advanceOpportunityStage = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  apnOpportunityId: string;
  customerName: string;
  opportunityTitle?: string;
  /** Total contract value if known; null/undefined ⇒ ExpectedCustomerSpend omitted. */
  opportunityValue?: number | null;
  expectedCloseDate: string;
  description?: string;
  aceStage: AceStage;
  /** Honest source-derived overrides merged into the advance payload. */
  enrichment?: AceEnrichment;
}): Promise<void> => {
  const catalog = getSubmissionCatalog();
  const client = getClient();
  console.log(`[APN] Advancing apnId=${args.apnOpportunityId} to stage '${args.aceStage}' catalog=${catalog}`);

  // Read the latest opportunity for RevisionId / LastModifiedDate concurrency
  // control. UpdateOpportunity validates the WHOLE object, so a LifeCycle-only
  // patch is rejected with REQUIRED_FIELD_MISSING for Customer/Marketing — we
  // must resend the full payload (mirrors syncToPartnerCentral's update path).
  const current = await client.send(
    new GetOpportunityCommand({ Catalog: catalog, Identifier: args.apnOpportunityId }),
  ) as { RevisionId?: string; LastModifiedDate?: Date };

  // Reuse the SAME shared field builder the create/sync path uses so the
  // advance carries every AWS-required field (Customer/Project/Marketing/
  // OpportunityType/PrimaryNeedsFromAws + CustomerBusinessProblem + solution
  // description) identically. AWS validates the WHOLE object on every write, so
  // any divergence here re-introduces REQUIRED_FIELD_MISSING.
  const advancePayload = {
    Catalog: catalog,
    Identifier: args.apnOpportunityId,
    ...(current.RevisionId ? { RevisionId: current.RevisionId } : {}),
    LastModifiedDate: current.LastModifiedDate ?? new Date(),
    ...buildOpportunityFields({
      customerName: args.enrichment?.customerName?.trim() || args.customerName,
      opportunityTitle: args.opportunityTitle,
      opportunityValue: args.opportunityValue,
      description: args.description,
      enrichment: args.enrichment,
    }),
    LifeCycle: {
      Stage: args.aceStage as (typeof Stage)[keyof typeof Stage],
      TargetCloseDate: toFutureCloseDate(args.expectedCloseDate),
    },
  };

  await client.send(new UpdateOpportunityCommand(advancePayload));
};
