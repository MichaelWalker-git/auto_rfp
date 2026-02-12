/**
 * ============================================================================
 * MIGRATION SCRIPT: Update DynamoDB user records to use Cognito sub as userId
 * ============================================================================
 *
 * PURPOSE:
 * Previously, user records in DynamoDB used a random UUID as userId.
 * The Cognito token contains a `sub` field (also a UUID) which is different.
 * This script migrates existing user records so that:
 *   - The DynamoDB userId matches the Cognito sub
 *   - The sort key (SK) is updated to use the Cognito sub
 *   - The frontend can use the token's `sub` to directly look up the user
 *
 * HOW IT WORKS:
 * 1. Lists all users from the Cognito User Pool (Dev environment)
 * 2. For each Cognito user, extracts: email, sub (UUID)
 * 3. Queries DynamoDB for the user record matching that email
 * 4. If found and userId !== sub:
 *    a. Creates a new DynamoDB item with the correct SK (using sub as userId)
 *    b. Deletes the old DynamoDB item (with the old SK)
 *    c. Updates the Cognito custom:userId attribute to match the sub
 *
 * PREREQUISITES:
 * - AWS credentials configured (aws configure or environment variables)
 * - Access to the Cognito User Pool and DynamoDB table
 * - Node.js 18+ with ts-node installed
 *
 * USAGE:
 *   DRY RUN (default — no changes made):
 *     npx ts-node scripts/migrate-user-ids-to-cognito-sub.ts
 *
 *   LIVE RUN (actually performs the migration):
 *     DRY_RUN=false npx ts-node scripts/migrate-user-ids-to-cognito-sub.ts
 *
 * ENVIRONMENT VARIABLES:
 *   AWS_REGION        — AWS region (default: us-east-1)
 *   USER_POOL_ID      — Cognito User Pool ID (required)
 *   TABLE_NAME        — DynamoDB table name (required)
 *   DRY_RUN           — Set to "false" to actually perform changes (default: true)
 *
 * SAFETY:
 * - Runs in DRY_RUN mode by default — only logs what would happen
 * - Each user migration is independent — if one fails, others continue
 * - Old records are only deleted AFTER the new record is successfully created
 * - Logs every action for audit trail
 *
 * ============================================================================
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================================
// CONFIGURATION — Update these for your environment
// ============================================================================

/** AWS region where Cognito and DynamoDB are deployed */
const REGION = process.env.AWS_REGION || 'us-east-1';

/** Cognito User Pool ID — find this in the AWS Console under Cognito > User Pools */
const USER_POOL_ID = process.env.USER_POOL_ID || '';

/** DynamoDB table name — the main application table */
const TABLE_NAME = process.env.TABLE_NAME || '';

/** DRY_RUN mode — when true, only logs what would happen without making changes */
const DRY_RUN = process.env.DRY_RUN !== 'false';

/** DynamoDB partition key and sort key names */
const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';

/** The partition key value for user records */
const USER_PK = 'USER';

// ============================================================================
// AWS CLIENT INITIALIZATION
// ============================================================================

/** Cognito client for listing users and updating attributes */
const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

/** DynamoDB document client for reading/writing user records */
const ddbClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

// ============================================================================
// HELPER: Build the DynamoDB sort key for a user
// ============================================================================

/**
 * Constructs the sort key for a user record.
 * Format: ORG#{orgId}#USER#{userId}
 *
 * @param orgId - The organization ID
 * @param userId - The user ID (will be the Cognito sub after migration)
 * @returns The formatted sort key string
 */
function userSk(orgId: string, userId: string): string {
  return `ORG#${orgId}#USER#${userId}`;
}

// ============================================================================
// STEP 1: List all Cognito users
// ============================================================================

/**
 * Fetches all users from the Cognito User Pool.
 * Handles pagination automatically (Cognito returns max 60 users per page).
 *
 * @returns Array of { email, sub, username } for each Cognito user
 */
async function listAllCognitoUsers(): Promise<Array<{
  email: string;
  sub: string;
  username: string;
}>> {
  const users: Array<{ email: string; sub: string; username: string }> = [];
  let paginationToken: string | undefined;

  console.log('📋 Listing all Cognito users...');

  do {
    // Cognito ListUsers API — returns up to 60 users per call
    const response = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );

    // Extract email and sub from each user's attributes
    for (const user of response.Users ?? []) {
      const attrs = user.Attributes ?? [];

      // Find the 'sub' attribute (Cognito's internal UUID for this user)
      const sub = attrs.find(a => a.Name === 'sub')?.Value;

      // Find the 'email' attribute
      const email = attrs.find(a => a.Name === 'email')?.Value;

      // Username is the login identifier (usually the email)
      const username = user.Username;

      if (sub && email && username) {
        users.push({ email: email.toLowerCase(), sub, username });
      } else {
        console.warn(`  ⚠️ Skipping user ${username} — missing sub or email`);
      }
    }

    // If there are more users, Cognito returns a pagination token
    paginationToken = response.PaginationToken;
  } while (paginationToken);

  console.log(`  Found ${users.length} Cognito users`);
  return users;
}

// ============================================================================
// STEP 2: Find the DynamoDB user record by email
// ============================================================================

/**
 * Queries DynamoDB to find a user record matching the given email.
 * Scans all USER records and filters by email (case-insensitive).
 *
 * Note: This is not efficient for large user bases, but works for migration.
 * In production, you'd use a GSI on email.
 *
 * @param email - The email to search for (lowercase)
 * @returns The DynamoDB item if found, or null
 */
async function findDynamoUserByEmail(email: string): Promise<Record<string, any> | null> {
  // Query all USER records (they all share the same partition key)
  const response = await ddbClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': PK_NAME },
      ExpressionAttributeValues: { ':pk': USER_PK },
      Limit: 500, // Adjust if you have more than 500 users
    }),
  );

  // Find the user with matching email (case-insensitive)
  const normalizedEmail = email.toLowerCase();
  return (response.Items ?? []).find(
    (item: any) => String(item.email ?? item.emailLower ?? '').toLowerCase() === normalizedEmail,
  ) ?? null;
}

// ============================================================================
// STEP 3: Migrate a single user
// ============================================================================

/**
 * Migrates a single user's DynamoDB record to use the Cognito sub as userId.
 *
 * Steps:
 * 1. Check if the current userId already matches the Cognito sub
 * 2. If not, create a new record with the correct SK (using sub)
 * 3. Delete the old record (with the old SK)
 * 4. Update the Cognito custom:userId attribute to match
 *
 * @param cognitoUser - The Cognito user info { email, sub, username }
 */
async function migrateUser(cognitoUser: { email: string; sub: string; username: string }): Promise<void> {
  const { email, sub, username } = cognitoUser;

  // Find the existing DynamoDB record for this user
  const existingItem = await findDynamoUserByEmail(email);

  if (!existingItem) {
    console.log(`  ❌ No DynamoDB record found for ${email} — skipping`);
    return;
  }

  const currentUserId = existingItem.userId;
  const orgId = existingItem.orgId;
  const currentSk = existingItem[SK_NAME];

  // Check if already migrated (userId === sub)
  if (currentUserId === sub) {
    console.log(`  ✅ ${email} — already using Cognito sub as userId (${sub})`);
    return;
  }

  console.log(`  🔄 ${email} — migrating userId: ${currentUserId} → ${sub}`);

  // Build the new sort key using the Cognito sub
  const newSk = userSk(orgId, sub);

  if (DRY_RUN) {
    console.log(`     [DRY RUN] Would create new record with SK: ${newSk}`);
    console.log(`     [DRY RUN] Would delete old record with SK: ${currentSk}`);
    console.log(`     [DRY RUN] Would update Cognito custom:userId to: ${sub}`);
    return;
  }

  // --- LIVE MIGRATION ---

  // Step 3a: Create new DynamoDB record with the Cognito sub as userId
  const newItem = {
    ...existingItem,
    [PK_NAME]: USER_PK,
    [SK_NAME]: newSk,
    userId: sub,
    // Keep all other fields the same
  };

  await ddbClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: newItem,
    }),
  );
  console.log(`     ✅ Created new record with SK: ${newSk}`);

  // Step 3b: Delete the old DynamoDB record
  await ddbClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        [PK_NAME]: USER_PK,
        [SK_NAME]: currentSk,
      },
    }),
  );
  console.log(`     ✅ Deleted old record with SK: ${currentSk}`);

  // Step 3c: Update Cognito custom:userId attribute to match the sub
  try {
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [
          { Name: 'custom:userId', Value: sub },
        ],
      }),
    );
    console.log(`     ✅ Updated Cognito custom:userId to: ${sub}`);
  } catch (err) {
    // Non-fatal — the custom attribute might not exist in the pool
    console.warn(`     ⚠️ Failed to update Cognito custom:userId (non-fatal):`, err);
  }
}

// ============================================================================
// MAIN: Run the migration
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('USER ID MIGRATION: DynamoDB userId → Cognito sub');
  console.log('='.repeat(70));
  console.log(`  Region:       ${REGION}`);
  console.log(`  User Pool:    ${USER_POOL_ID}`);
  console.log(`  Table:        ${TABLE_NAME}`);
  console.log(`  Mode:         ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '🔴 LIVE (will modify data!)'}`);
  console.log('='.repeat(70));

  // Validate configuration
  if (!USER_POOL_ID) {
    console.error('❌ USER_POOL_ID environment variable is required');
    process.exit(1);
  }
  if (!TABLE_NAME) {
    console.error('❌ TABLE_NAME environment variable is required');
    process.exit(1);
  }

  // Step 1: Get all Cognito users
  const cognitoUsers = await listAllCognitoUsers();

  // Step 2-3: Migrate each user
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of cognitoUsers) {
    try {
      await migrateUser(user);
      migrated++;
    } catch (err) {
      console.error(`  ❌ Error migrating ${user.email}:`, err);
      errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total Cognito users: ${cognitoUsers.length}`);
  console.log(`  Processed:           ${migrated}`);
  console.log(`  Errors:              ${errors}`);
  console.log(`  Mode:                ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(70));

  if (DRY_RUN) {
    console.log('\n💡 To run the actual migration, set DRY_RUN=false:');
    console.log('   DRY_RUN=false USER_POOL_ID=xxx TABLE_NAME=yyy npx ts-node scripts/migrate-user-ids-to-cognito-sub.ts');
  }
}

// Run the migration
// main().catch(console.error);

// ============================================================================
// UNCOMMENT THE LINE ABOVE TO RUN THE SCRIPT
// ============================================================================