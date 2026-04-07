/**
 * Finds USER records in DynamoDB that are missing the `userId` field.
 * These users won't appear in the byUserId GSI, meaning:
 * - get-my-organizations won't find their org memberships
 * - Any GSI-based lookup will miss them
 *
 * Usage:
 *   npx tsx scripts/find-users-missing-from-gsi.ts [table-name] [region]
 *
 * Example:
 *   npx tsx scripts/find-users-missing-from-gsi.ts auto-rfp-dev-table us-east-1
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.argv[2] || process.env.DB_TABLE_NAME;
const REGION = process.argv[3] || process.env.AWS_REGION || 'us-east-1';

if (!TABLE_NAME) {
  console.error('Usage: npx tsx scripts/find-users-missing-from-gsi.ts <table-name> [region]');
  process.exit(1);
}

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const USER_PK = 'USER';
const GSI_BY_USER_ID = 'byUserId';

interface UserRecord {
  [PK_NAME]: string;
  [SK_NAME]: string;
  userId?: string;
  email?: string;
  orgId?: string;
  role?: string;
  cognitoUsername?: string;
}

const scanAllUsers = async (): Promise<UserRecord[]> => {
  const users: UserRecord[] = [];
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

    for (const item of res.Items ?? []) {
      users.push(item as UserRecord);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return users;
};

const queryGsiForUser = async (userId: string): Promise<number> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_BY_USER_ID,
      KeyConditionExpression: '#userId = :userId AND #pk = :pk',
      ExpressionAttributeNames: { '#userId': 'userId', '#pk': PK_NAME },
      ExpressionAttributeValues: { ':userId': userId, ':pk': USER_PK },
      Select: 'COUNT',
    }),
  );
  return res.Count ?? 0;
};

const main = async () => {
  console.log(`\nScanning table: ${TABLE_NAME} (region: ${REGION})\n`);

  const allUsers = await scanAllUsers();
  console.log(`Total USER records found: ${allUsers.length}\n`);

  // 1. Users missing userId field entirely
  const missingUserId = allUsers.filter((u) => !u.userId);
  if (missingUserId.length > 0) {
    console.log(`❌ Users MISSING userId field (invisible to GSI):`);
    for (const u of missingUserId) {
      console.log(`   SK: ${u[SK_NAME]}  email: ${u.email ?? '?'}  role: ${u.role ?? '?'}`);
    }
    console.log();
  } else {
    console.log(`✅ All USER records have a userId field.\n`);
  }

  // 2. Users with userId but not found in GSI
  const withUserId = allUsers.filter((u) => !!u.userId);
  const notInGsi: UserRecord[] = [];

  console.log(`Checking ${withUserId.length} users against byUserId GSI...`);
  for (const u of withUserId) {
    const count = await queryGsiForUser(u.userId!);
    if (count === 0) {
      notInGsi.push(u);
    }
  }

  if (notInGsi.length > 0) {
    console.log(`\n❌ Users with userId but NOT found in GSI:`);
    for (const u of notInGsi) {
      console.log(`   userId: ${u.userId}  SK: ${u[SK_NAME]}  email: ${u.email ?? '?'}`);
    }
  } else {
    console.log(`✅ All users with userId are present in GSI.\n`);
  }

  // 3. Summary: group by org
  console.log(`\n── Summary by org ──`);
  const byOrg = new Map<string, UserRecord[]>();
  for (const u of allUsers) {
    const org = u.orgId || 'NO_ORG';
    if (!byOrg.has(org)) byOrg.set(org, []);
    byOrg.get(org)!.push(u);
  }

  for (const [orgId, users] of byOrg) {
    const missing = users.filter((u) => !u.userId).length;
    console.log(`   ${orgId}: ${users.length} users (${missing} missing userId)`);
  }

  console.log(`\nDone.`);
};

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});