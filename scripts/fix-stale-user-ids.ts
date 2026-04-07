/**
 * One-off script to fix stale userId values in DynamoDB USER records.
 *
 * For each email that has USER records across multiple orgs, this script:
 * 1. Looks up the current Cognito sub for that email
 * 2. Finds any DynamoDB records with a mismatched userId
 * 3. Deletes the old record and creates a new one with the correct userId + sort_key
 *
 * Usage:
 *   npx tsx scripts/fix-stale-user-ids.ts <table-name> <user-pool-id> [region] [--dry-run]
 *
 * Examples:
 *   npx tsx scripts/fix-stale-user-ids.ts RFP-table-Dev us-east-1_XXXXX us-east-1 --dry-run
 *   npx tsx scripts/fix-stale-user-ids.ts RFP-table-Dev us-east-1_XXXXX us-east-1
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const TABLE_NAME = process.argv[2];
const USER_POOL_ID = process.argv[3];
const REGION = process.argv[4] || 'us-east-1';
const DRY_RUN = process.argv.includes('--dry-run');

if (!TABLE_NAME || !USER_POOL_ID) {
  console.error('Usage: npx tsx scripts/fix-stale-user-ids.ts <table-name> <user-pool-id> [region] [--dry-run]');
  process.exit(1);
}

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const USER_PK = 'USER';

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);
const cognito = new CognitoIdentityProviderClient({ region: REGION });

const userSk = (orgId: string, userId: string) => `ORG#${orgId}#USER#${userId}`;

interface UserRecord {
  [key: string]: unknown;
  partition_key: string;
  sort_key: string;
  userId: string;
  email?: string;
  emailLower?: string;
  orgId?: string;
  cognitoUsername?: string;
}

const getCognitoSub = async (email: string): Promise<string | null> => {
  try {
    const res = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email.toLowerCase(),
      }),
    );
    return res.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'UserNotFoundException') return null;
    throw e;
  }
};

const main = async () => {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : ''}`);
  console.log(`Table: ${TABLE_NAME}  Pool: ${USER_POOL_ID}  Region: ${REGION}\n`);

  // 1. Scan all USER records
  const allUsers: UserRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK_NAME },
        ExpressionAttributeValues: { ':pk': USER_PK },
        ExclusiveStartKey,
      }),
    );
    allUsers.push(...((res.Items as UserRecord[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(`Total USER records: ${allUsers.length}\n`);

  // 2. Group by email
  const byEmail = new Map<string, UserRecord[]>();
  for (const u of allUsers) {
    const email = ((u.emailLower || u.email || '') as string).toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(u);
  }

  // 3. For each email with records, check Cognito sub
  let totalFixed = 0;
  let totalSkipped = 0;

  for (const [email, records] of byEmail) {
    const cognitoSub = await getCognitoSub(email);

    if (!cognitoSub) {
      const stale = records.filter((r) => r.userId);
      if (stale.length > 0) {
        console.log(`⚠️  ${email}: no Cognito user found (${stale.length} DynamoDB records orphaned)`);
      }
      continue;
    }

    const staleRecords = records.filter((r) => r.userId && r.userId !== cognitoSub);

    if (staleRecords.length === 0) continue;

    console.log(`\n🔧 ${email}: Cognito sub = ${cognitoSub}`);

    for (const record of staleRecords) {
      const orgId = record.orgId as string;
      const oldUserId = record.userId;
      const oldSk = record[SK_NAME];
      const newSk = userSk(orgId, cognitoSub);

      console.log(`   org ${orgId}: ${oldUserId} → ${cognitoSub}`);

      if (DRY_RUN) {
        totalSkipped++;
        continue;
      }

      try {
        // Delete old record
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { [PK_NAME]: USER_PK, [SK_NAME]: oldSk },
          }),
        );

        // Create new record with correct userId + sort_key
        const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...rest } = record;
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              ...rest,
              [PK_NAME]: USER_PK,
              [SK_NAME]: newSk,
              userId: cognitoSub,
              updatedAt: new Date().toISOString(),
            },
          }),
        );

        totalFixed++;
        console.log(`   ✅ Fixed`);
      } catch (err) {
        console.error(`   ❌ Failed:`, err);
      }
    }
  }

  console.log(`\n── Summary ──`);
  if (DRY_RUN) {
    console.log(`Would fix: ${totalSkipped} record(s)`);
    console.log(`\nRun without --dry-run to apply changes.`);
  } else {
    console.log(`Fixed: ${totalFixed} record(s)`);
  }
  console.log();
};

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});