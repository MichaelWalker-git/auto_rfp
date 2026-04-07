
/**
 * Finds all USER records for a given email across all orgs.
 * Shows userId differences that would cause GSI lookup mismatches.
 *
 * Usage: npx tsx scripts/check-user-by-email.ts <email> [table-name] [region]
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const EMAIL = process.argv[2];
const TABLE_NAME = process.argv[3] || 'RFP-table-Dev';
const REGION = process.argv[4] || 'us-east-1';

if (!EMAIL) {
  console.error('Usage: npx tsx scripts/check-user-by-email.ts <email> [table-name] [region]');
  process.exit(1);
}

const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const main = async () => {
  const emailLower = EMAIL.trim().toLowerCase();
  console.log(`\nSearching for "${emailLower}" in ${TABLE_NAME}\n`);

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#pk = :pk AND emailLower = :email',
        ExpressionAttributeNames: { '#pk': 'partition_key' },
        ExpressionAttributeValues: { ':pk': 'USER', ':email': emailLower },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (items.length === 0) {
    console.log('No USER records found for this email.');
    return;
  }

  console.log(`Found ${items.length} USER record(s):\n`);

  const userIds = new Set<string>();

  for (const item of items) {
    const userId = item['userId'] as string;
    userIds.add(userId);
    console.log(`  orgId:            ${item['orgId']}`);
    console.log(`  userId:           ${userId}`);
    console.log(`  sort_key:         ${item['sort_key']}`);
    console.log(`  role:             ${item['role']}`);
    console.log(`  cognitoUsername:   ${item['cognitoUsername']}`);
    console.log(`  createdAt:        ${item['createdAt']}`);
    console.log();
  }

  if (userIds.size > 1) {
    console.log(`❌ MISMATCH: This email has ${userIds.size} different userIds across orgs:`);
    for (const id of userIds) {
      console.log(`   - ${id}`);
    }
    console.log(`\n   The Cognito sub matches only ONE of these.`);
    console.log(`   The other org's USER record won't be found by the byUserId GSI.`);
    console.log(`   Fix: update the mismatched record's userId to the Cognito sub.`);
  } else {
    console.log(`✅ Same userId across all orgs: ${[...userIds][0]}`);
  }
};

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});