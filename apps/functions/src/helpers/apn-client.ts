import {
  PartnerCentralSellingClient,
  CreateOpportunityCommand,
  UpdateOpportunityCommand,
  GetOpportunityCommand,
  SubmitOpportunityCommand,
  Stage,
  MarketingSource,
} from '@aws-sdk/client-partnercentral-selling';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
}

/**
 * Sync an opportunity to AWS Partner Central.
 * Simplified approach with better error handling and timeout management.
 */
export const syncToPartnerCentral = async (args: SyncToApnArgs): Promise<void> => {
  const {
    orgId, projectId, oppId, customerName, opportunityTitle,
    opportunityValue, expectedCloseDate, proposalStatus, description, existingApnId,
  } = args;

  console.log(`[APN] Starting sync for oppId=${oppId}, proposalStatus=${proposalStatus}, existingApnId=${existingApnId}`);

  // Map proposal status to APN stage
  const stage = stageMap[proposalStatus] ?? Stage.PROSPECT;
  console.log(`[APN] Mapped '${proposalStatus}' to stage '${stage}'`);

  // Prepare LifeCycle with conditional closedLostReason
  const lifecycle: any = {
    Stage: stage,
    TargetCloseDate: expectedCloseDate.split('T')[0],
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
    Marketing: {
      Source: MarketingSource.MARKETING_ACTIVITY,
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
