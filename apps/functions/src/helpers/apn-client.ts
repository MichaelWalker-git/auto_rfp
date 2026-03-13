import {
  PartnerCentralSellingClient,
  CreateOpportunityCommand,
  UpdateOpportunityCommand,
  SubmitOpportunityCommand,
  Stage,
  type CreateOpportunityCommandInput,
  type UpdateOpportunityCommandInput,
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
      requestTimeout: 30000, // 30 second timeout
      connectionTimeout: 10000, // 10 second connection timeout
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
    LifeCycle: {
      Stage: stage,
      TargetCloseDate: expectedCloseDate.split('T')[0],
    },
  };

  const client = getClient();
  let apnId: string;

  try {
    if (existingApnId) {
      // UPDATE existing opportunity
      console.log(`[APN] Updating opportunity ${existingApnId} to stage ${stage}`);
      
      const updateCommand = new UpdateOpportunityCommand({
        ...payload,
        Identifier: existingApnId,
        LastModifiedDate: new Date(),
      });

      console.log(`[APN] Sending UpdateOpportunityCommand...`);
      const response = await Promise.race([
        client.send(updateCommand),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AWS Partner Central API timeout after 20 seconds')), 20000)
        )
      ]);

      console.log(`[APN] Update successful:`, response);
      apnId = existingApnId;
    } else {
      // CREATE new opportunity
      console.log(`[APN] Creating new opportunity with stage ${stage}`);
      
      const createCommand = new CreateOpportunityCommand({
        ...payload,
        ClientToken: `${orgId}-${oppId}`,
      });

      console.log(`[APN] Sending CreateOpportunityCommand...`);
      const response = await Promise.race([
        client.send(createCommand),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AWS Partner Central API timeout after 20 seconds')), 20000)
        )
      ]);

      apnId = (response as any).Id ?? '';
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
