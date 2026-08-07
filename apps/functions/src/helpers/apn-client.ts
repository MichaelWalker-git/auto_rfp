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
} from '@aws-sdk/client-partnercentral-selling';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AceStage } from '@auto-rfp/core';
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
  opportunityValue:  number;
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
}

/**
 * Sync an opportunity to AWS Partner Central.
 * Simplified approach with better error handling and timeout management.
 */
export const syncToPartnerCentral = async (args: SyncToApnArgs): Promise<void> => {
  const {
    orgId, projectId, oppId, customerName, opportunityTitle,
    opportunityValue, expectedCloseDate, proposalStatus, description, existingApnId,
    aceStage,
  } = args;

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

  // Prepare API payload
  const payload = {
    Catalog: APN_CATALOG,
    Customer: {
      Account: {
        CompanyName: customerName,
        Industry: 'Government' as const,
        WebsiteUrl: 'https://unknown.gov',
        Address: { CountryCode: 'US' as const },
      },
    },
    Project: {
      Title: opportunityTitle || customerName,
      CustomerUseCase: 'Business Applications & Contact Center' as const,
      DeliveryModels: ['SaaS or PaaS' as const],
      ExpectedCustomerSpend: [{
        Amount: String(Math.max(opportunityValue, 1)),
        CurrencyCode: 'USD' as const,
        Frequency: 'Monthly' as const,
        TargetCompany: 'AWS',
      }],
    },
    LifeCycle: lifecycle,
    // These opportunities are not sourced from an AWS marketing activity and use
    // no MDF funding. ACE requires AwsFundingUsed to be set; UseCases must stay
    // empty while AwsFundingUsed = No.
    Marketing: {
      Source: MarketingSource.NONE,
      AwsFundingUsed: AwsFundingUsed.NO,
    },
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

      // Step 4: Send update with RevisionId
      const updatePayload = {
        Catalog: APN_CATALOG,
        Identifier: existingApnId,
        RevisionId: currentRevisionId,
        LastModifiedDate: (getResponse as any).LastModifiedDate ?? new Date(),
        Customer: payload.Customer,
        Project: payload.Project,
        LifeCycle: payload.LifeCycle,
        Marketing: payload.Marketing,
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
  opportunityValue: number;
  expectedCloseDate: string;
  aceStage: AceStage;
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

  const advancePayload = {
    Catalog: catalog,
    Identifier: args.apnOpportunityId,
    ...(current.RevisionId ? { RevisionId: current.RevisionId } : {}),
    LastModifiedDate: current.LastModifiedDate ?? new Date(),
    Customer: {
      Account: {
        CompanyName: args.customerName,
        Industry: 'Government' as const,
        WebsiteUrl: 'https://unknown.gov',
        Address: { CountryCode: 'US' as const },
      },
    },
    Project: {
      Title: args.opportunityTitle || args.customerName,
      CustomerUseCase: 'Business Applications & Contact Center' as const,
      DeliveryModels: ['SaaS or PaaS' as const],
      ExpectedCustomerSpend: [{
        Amount: String(Math.max(args.opportunityValue, 1)),
        CurrencyCode: 'USD' as const,
        Frequency: 'Monthly' as const,
        TargetCompany: 'AWS',
      }],
    },
    LifeCycle: {
      Stage: args.aceStage as (typeof Stage)[keyof typeof Stage],
      TargetCloseDate: toFutureCloseDate(args.expectedCloseDate),
    },
    Marketing: {
      Source: MarketingSource.NONE,
      AwsFundingUsed: AwsFundingUsed.NO,
    },
  };

  await client.send(new UpdateOpportunityCommand(advancePayload));
};
