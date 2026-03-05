import { ScanCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  CONTENT_LIBRARY_PK,
  FRESHNESS_WARNING_DAYS,
  FRESHNESS_STALE_DAYS,
  CERTIFICATION_KEYWORDS,
  parseContentLibrarySK,
  PAST_PROJECT_PK,
  parsePastProjectSK,
} from '@auto-rfp/core';
import type {
  FreshnessStatus,
  StaleReason,
  ContentLibraryItem,
  StaleContentReportResponse,
  StaleContentReportItem,
  PastProject as PastProjectItem,
} from '@auto-rfp/core';
import { docClient, DBItem } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { getOrgMembers, getUserByOrgAndId } from '@/helpers/user';

// ─── DB Item Types ───

type ContentLibraryDBItem = ContentLibraryItem & DBItem;
type DocumentDBItem = DocumentItem & DBItem;
type PastProjectDBItem = PastProjectItem & DBItem;

// ─── Types ───

export interface DetectionResult {
  itemId: string;
  orgId: string;
  kbId: string;
  source: 'CONTENT_LIBRARY' | 'KB_DOCUMENT' | 'PAST_PERFORMANCE';
  previousStatus: FreshnessStatus;
  newStatus: FreshnessStatus;
  reason: StaleReason;
}

export interface DetectionSummary {
  totalScanned: number;
  contentLibraryScanned: number;
  kbDocumentsScanned: number;
  pastPerformanceScanned: number;
  staleDetected: number;
  warningDetected: number;
  notificationsSent: boolean;
}

interface DocumentItem {
  id: string;
  knowledgeBaseId: string;
  name: string;
  indexStatus?: string;
  updatedAt?: string;
  createdAt?: string;
  freshnessStatus?: FreshnessStatus;
  staleReason?: StaleReason;
  staleSince?: string;
  lastFreshnessCheck?: string;
}

// ─── Constants ───

const DOCUMENT_PK = 'DOCUMENT';

// ─── Helpers ───

function daysBetween(dateStr: string | null | undefined, now: Date): number {
  if (!dateStr) return Infinity;
  const date = new Date(dateStr);
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function statusSeverity(status: FreshnessStatus): number {
  const severityMap: Record<FreshnessStatus, number> = {
    ACTIVE: 0,
    WARNING: 1,
    STALE: 2,
    ARCHIVED: 3,
  };
  return severityMap[status] ?? 0;
}

function isCertificationContent(item: ContentLibraryItem): boolean {
  const text = `${item.question ?? ''} ${item.answer ?? ''} ${item.category ?? ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  return CERTIFICATION_KEYWORDS.some((kw: string) => text.includes(kw.toLowerCase()));
}

function checkCertExpiry(item: ContentLibraryItem, now: Date): { expired: boolean; expiryDate: string | null } {
  const certExpiry = (item as Record<string, unknown>).certExpiryDate as string | undefined;
  if (certExpiry) {
    const expiry = new Date(certExpiry);
    return { expired: expiry <= now, expiryDate: certExpiry };
  }

  const datePatterns = [
    /(?:expires?|expiry|expiration|valid until|renewal)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:expires?|expiry|expiration|valid until|renewal)[:\s]+(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
    /(?:expires?|expiry|expiration|valid until|renewal)[:\s]+([A-Za-z]+ \d{1,2},?\s*\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = (item.answer ?? '').match(pattern);
    if (match?.[1]) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) {
          return { expired: parsed <= now, expiryDate: parsed.toISOString() };
        }
      } catch {
        // Skip unparseable dates
      }
    }
  }

  return { expired: false, expiryDate: null };
}

// ─── Detection Rules for Content Library ───

function detectUnusedContent(item: ContentLibraryItem, now: Date): { status: FreshnessStatus; reason: StaleReason } | null {
  const referenceDate = item.lastUsedAt || item.createdAt;
  const days = daysBetween(referenceDate, now);

  if (days >= FRESHNESS_STALE_DAYS) return { status: 'STALE', reason: 'NOT_USED' };
  if (days >= FRESHNESS_WARNING_DAYS) return { status: 'WARNING', reason: 'NOT_USED' };
  return null;
}

function detectExpiredCert(item: ContentLibraryItem, now: Date): { status: FreshnessStatus; reason: StaleReason } | null {
  if (!isCertificationContent(item)) return null;
  const { expired } = checkCertExpiry(item, now);
  if (expired) return { status: 'STALE', reason: 'CERT_EXPIRED' };
  return null;
}

async function detectSourceUpdated(item: ContentLibraryItem, tableName: string): Promise<{ status: FreshnessStatus; reason: StaleReason } | null> {
  if (!item.sources || item.sources.length === 0) return null;

  for (const source of item.sources) {
    if (!source.documentId) continue;
    try {
      const result = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'id = :docId',
          ExpressionAttributeValues: { ':docId': source.documentId },
          Limit: 1,
        }),
      );
      if (result.Items?.[0]) {
        const docUpdatedAt = result.Items[0].updatedAt as string | undefined;
        if (docUpdatedAt && item.updatedAt && new Date(docUpdatedAt) > new Date(item.updatedAt)) {
          return { status: 'WARNING', reason: 'SOURCE_UPDATED' };
        }
      }
    } catch {
      // Continue checking other sources
    }
  }
  return null;
}

function detectConflicts(
  item: ContentLibraryItem,
  allItems: ContentLibraryItem[],
): { status: FreshnessStatus; reason: StaleReason; conflictsWith: string } | null {
  if (!item.question || !item.answer) return null;

  const normalizedQuestion = item.question.toLowerCase().trim().replace(/[?!.]+$/, '');

  for (const other of allItems) {
    if (other.id === item.id || other.isArchived || !other.question || !other.answer) continue;

    const otherNormalized = other.question.toLowerCase().trim().replace(/[?!.]+$/, '');
    const isSimilar =
      normalizedQuestion === otherNormalized ||
      normalizedQuestion.includes(otherNormalized) ||
      otherNormalized.includes(normalizedQuestion);

    if (!isSimilar) continue;

    const thisDate = new Date(item.updatedAt);
    const otherDate = new Date(other.updatedAt);

    if (otherDate > thisDate) {
      const shorter = Math.min(item.answer.length, other.answer.length);
      const longer = Math.max(item.answer.length, other.answer.length);
      const lengthRatio = shorter / longer;

      if (lengthRatio < 0.8 || item.answer.toLowerCase() !== other.answer.toLowerCase()) {
        return { status: 'WARNING', reason: 'CONFLICTING_ANSWER', conflictsWith: other.id };
      }
    }
  }
  return null;
}

// ─── Detection Rules for KB Documents ───

function detectStaleDocument(doc: DocumentItem, now: Date): { status: FreshnessStatus; reason: StaleReason } | null {
  const referenceDate = doc.updatedAt || doc.createdAt;
  const days = daysBetween(referenceDate, now);

  if (days >= FRESHNESS_STALE_DAYS) return { status: 'STALE', reason: 'NOT_USED' };
  if (days >= FRESHNESS_WARNING_DAYS) return { status: 'WARNING', reason: 'NOT_USED' };
  return null;
}

// ─── DynamoDB Update Helpers ───

async function updateItemFreshness(
  tableName: string,
  pk: string,
  sk: string,
  status: FreshnessStatus,
  reason: StaleReason,
  now: Date,
): Promise<void> {
  const updateExprParts = [
    'freshnessStatus = :status',
    'staleReason = :reason',
    'lastFreshnessCheck = :checkTime',
    'updatedAt = :now',
  ];
  const exprValues: Record<string, unknown> = {
    ':status': status,
    ':reason': reason,
    ':checkTime': now.toISOString(),
    ':now': now.toISOString(),
  };

  if (status === 'STALE' || status === 'WARNING') {
    updateExprParts.push('staleSince = if_not_exists(staleSince, :now)');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { [PK_NAME]: pk, [SK_NAME]: sk },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeValues: exprValues,
    }),
  );
}

async function clearItemStaleness(tableName: string, pk: string, sk: string, now: Date): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { [PK_NAME]: pk, [SK_NAME]: sk },
      UpdateExpression:
        'SET freshnessStatus = :active, lastFreshnessCheck = :checkTime, updatedAt = :now REMOVE staleSince, staleReason',
      ExpressionAttributeValues: {
        ':active': 'ACTIVE',
        ':checkTime': now.toISOString(),
        ':now': now.toISOString(),
      },
    }),
  );
}

async function touchFreshnessCheck(tableName: string, pk: string, sk: string, now: Date): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { [PK_NAME]: pk, [SK_NAME]: sk },
      UpdateExpression: 'SET lastFreshnessCheck = :checkTime',
      ExpressionAttributeValues: { ':checkTime': now.toISOString() },
    }),
  );
}

// ─── Notification ───

const STALE_REASON_LABELS: Record<string, string> = {
  NOT_USED: 'not been used recently',
  CERT_EXPIRED: 'a certification has expired',
  SOURCE_UPDATED: 'a source document was updated',
  CONFLICTING_ANSWER: 'a conflicting answer was found',
  MANUAL: 'it was manually flagged',
};

/**
 * Send both SNS (email/webhook) and in-app notifications for newly stale/warning items.
 * - Notifies the content author (createdBy) if available.
 * - Falls back to all org members if no author is found.
 */
export async function sendStaleNotifications(
  snsTopicArn: string,
  results: DetectionResult[],
  contentItems?: ContentLibraryDBItem[],
): Promise<void> {
  if (results.length === 0) return;

  const staleCount = results.filter((r) => r.newStatus === 'STALE').length;
  const warningCount = results.filter((r) => r.newStatus === 'WARNING').length;

  // ── 1. SNS notification (email/webhook) ──
  if (snsTopicArn) {
    const snsClient = new SNSClient({});
    const message = JSON.stringify({
      type: 'STALE_CONTENT_DETECTED',
      timestamp: new Date().toISOString(),
      summary: { totalFlagged: results.length, stale: staleCount, warning: warningCount },
      items: results.map((r) => ({
        itemId: r.itemId,
        orgId: r.orgId,
        source: r.source,
        status: r.newStatus,
        reason: r.reason,
      })),
    });

    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: snsTopicArn,
          Subject: `Stale Content Alert: ${staleCount} stale, ${warningCount} warnings`,
          Message: message,
        }),
      );
    } catch (err) {
      console.error('Failed to send SNS notification:', err);
    }
  }

  // ── 2. In-app notifications per org ──
  // Group results by orgId
  const byOrg = new Map<string, DetectionResult[]>();
  for (const r of results) {
    if (!r.orgId) continue;
    if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, []);
    byOrg.get(r.orgId)!.push(r);
  }

  // Build a lookup map: itemId → createdBy
  const authorMap = new Map<string, string>();
  if (contentItems) {
    for (const item of contentItems) {
      if (item.id && item.createdBy) {
        authorMap.set(item.id, item.createdBy);
      }
    }
  }

  for (const [orgId, orgResults] of byOrg) {
    // Group by author so each author gets one notification per run
    const byAuthor = new Map<string, DetectionResult[]>();

    for (const r of orgResults) {
      const authorId = authorMap.get(r.itemId);
      const key = authorId || '__all__';
      if (!byAuthor.has(key)) byAuthor.set(key, []);
      byAuthor.get(key)!.push(r);
    }

    // Resolve recipients for __all__ (org members fallback)
    let orgMembers: Array<{ userId: string; email: string }> = [];
    if (byAuthor.has('__all__')) {
      try {
        orgMembers = await getOrgMembers(orgId);
      } catch (err) {
        console.warn(`Failed to fetch org members for ${orgId}:`, err);
      }
    }

    for (const [authorKey, authorResults] of byAuthor) {
      const stale = authorResults.filter((r) => r.newStatus === 'STALE');
      const warnings = authorResults.filter((r) => r.newStatus === 'WARNING');

      let recipientUserIds: string[] = [];
      let recipientEmails: string[] = [];

      if (authorKey === '__all__') {
        recipientUserIds = orgMembers.map((m) => m.userId);
        recipientEmails = orgMembers.map((m) => m.email);
      } else {
        // Verify the author exists in this org
        try {
          const author = await getUserByOrgAndId(orgId, authorKey);
          if (author) {
            recipientUserIds = [author.userId];
            recipientEmails = author.email ? [author.email] : [];
          } else {
            // Author not found in org — fall back to all members
            if (orgMembers.length === 0) {
              orgMembers = await getOrgMembers(orgId);
            }
            recipientUserIds = orgMembers.map((m) => m.userId);
            recipientEmails = orgMembers.map((m) => m.email);
          }
        } catch (err) {
          console.warn(`Failed to fetch author ${authorKey}:`, err);
          continue;
        }
      }

      if (recipientUserIds.length === 0) continue;

      // Build notification message
      const totalFlagged = authorResults.length;
      const firstResult = authorResults[0];
      const reasonLabel = STALE_REASON_LABELS[firstResult.reason] ?? firstResult.reason;

      const isStale = stale.length > 0;
      const type = isStale ? 'STALE_CONTENT_DETECTED' : 'STALE_CONTENT_WARNING';
      const title = isStale
        ? `${stale.length} Q&A ${stale.length === 1 ? 'item' : 'items'} marked stale`
        : `${warnings.length} Q&A ${warnings.length === 1 ? 'item' : 'items'} need review`;

      const message = totalFlagged === 1
        ? `A Q&A Library item has been flagged because ${reasonLabel}. Please review and update it.`
        : `${totalFlagged} Q&A Library items have been flagged (${stale.length} stale, ${warnings.length} warnings). Please review and update them.`;

      // Send one notification per recipient
      for (const userId of recipientUserIds) {
        const payload = buildNotification(
          type as 'STALE_CONTENT_DETECTED' | 'STALE_CONTENT_WARNING',
          title,
          message,
          {
            orgId,
            entityId: totalFlagged === 1 ? firstResult.itemId : undefined,
            recipientUserIds: [userId],
            recipientEmails: recipientEmails.filter((_, i) => recipientUserIds[i] === userId),
            actorDisplayName: 'Stale Content Scanner',
          },
        );

        sendNotification(payload).catch((err: unknown) =>
          console.warn('Failed to send stale content in-app notification:', err),
        );
      }
    }
  }
}

// ─── Core Detection: Content Library ───

async function scanContentLibraryItems(tableName: string): Promise<ContentLibraryDBItem[]> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const allItems: ContentLibraryDBItem[] = [];

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: `${PK_NAME} = :pk`,
        ExpressionAttributeValues: { ':pk': CONTENT_LIBRARY_PK },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const rawItem of scanResult.Items || []) {
      allItems.push(rawItem as unknown as ContentLibraryDBItem);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
}

export async function detectStaleContentLibrary(tableName: string, now: Date): Promise<DetectionResult[]> {
  const allItems = await scanContentLibraryItems(tableName);
  const results: DetectionResult[] = [];

  console.log(`Found ${allItems.length} content library items to check`);

  // Group items by org for conflict detection
  const itemsByOrg = new Map<string, ContentLibraryDBItem[]>();
  for (const item of allItems) {
    if (item.isArchived) continue;
    const key = item.orgId;
    if (!itemsByOrg.has(key)) itemsByOrg.set(key, []);
    itemsByOrg.get(key)!.push(item);
  }

  for (const item of allItems) {
    if (item.isArchived) continue;
    const currentFreshness = (item as Record<string, unknown>).freshnessStatus as FreshnessStatus | undefined;
    if (currentFreshness === 'ARCHIVED') continue;

    const previousStatus: FreshnessStatus = currentFreshness || 'ACTIVE';
    let worstStatus: FreshnessStatus = 'ACTIVE';
    let worstReason: StaleReason | null = null;

    // Rule 1: Check usage staleness
    const usageResult = detectUnusedContent(item, now);
    if (usageResult && statusSeverity(usageResult.status) > statusSeverity(worstStatus)) {
      worstStatus = usageResult.status;
      worstReason = usageResult.reason;
    }

    // Rule 2: Check certification expiry
    const certResult = detectExpiredCert(item, now);
    if (certResult && statusSeverity(certResult.status) > statusSeverity(worstStatus)) {
      worstStatus = certResult.status;
      worstReason = certResult.reason;
    }

    // Rule 3: Check source document updates
    const sourceResult = await detectSourceUpdated(item, tableName);
    if (sourceResult && statusSeverity(sourceResult.status) > statusSeverity(worstStatus)) {
      worstStatus = sourceResult.status;
      worstReason = sourceResult.reason;
    }

    // Rule 4: Check for conflicting answers
    const orgItems = itemsByOrg.get(item.orgId) || [];
    const conflictResult = detectConflicts(item, orgItems);
    if (conflictResult && statusSeverity(conflictResult.status) > statusSeverity(worstStatus)) {
      worstStatus = conflictResult.status;
      worstReason = conflictResult.reason;
    }

    // Update DynamoDB
    const sk = item[SK_NAME];
    if (worstStatus !== previousStatus || worstReason) {
      const parsed = parseContentLibrarySK(sk);

      if (worstStatus === 'ACTIVE' && previousStatus !== 'ACTIVE') {
        await clearItemStaleness(tableName, CONTENT_LIBRARY_PK, sk, now);
      } else if (worstReason) {
        await updateItemFreshness(tableName, CONTENT_LIBRARY_PK, sk, worstStatus, worstReason, now);

        if (parsed) {
          results.push({
            itemId: parsed.itemId,
            orgId: parsed.orgId,
            kbId: '',
            source: 'CONTENT_LIBRARY',
            previousStatus,
            newStatus: worstStatus,
            reason: worstReason,
          });
        }
      }
    } else {
      await touchFreshnessCheck(tableName, CONTENT_LIBRARY_PK, sk, now);
    }
  }

  return results;
}

// ─── Core Detection: KB Documents ───

async function scanKBDocuments(tableName: string): Promise<DocumentDBItem[]> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const allDocs: DocumentDBItem[] = [];

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: `${PK_NAME} = :pk`,
        ExpressionAttributeValues: { ':pk': DOCUMENT_PK },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const rawItem of scanResult.Items || []) {
      allDocs.push(rawItem as unknown as DocumentDBItem);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allDocs;
}

export async function detectStaleKBDocuments(tableName: string, now: Date): Promise<DetectionResult[]> {
  const allDocs = await scanKBDocuments(tableName);
  const results: DetectionResult[] = [];

  console.log(`Found ${allDocs.length} KB documents to check`);

  for (const doc of allDocs) {
    const previousStatus: FreshnessStatus = doc.freshnessStatus || 'ACTIVE';
    if (previousStatus === 'ARCHIVED') continue;

    const staleResult = detectStaleDocument(doc, now);

    if (staleResult) {
      const newStatus = staleResult.status;
      const reason = staleResult.reason;

      if (newStatus !== previousStatus) {
        await updateItemFreshness(tableName, DOCUMENT_PK, doc[SK_NAME], newStatus, reason, now);

        results.push({
          itemId: doc.id,
          orgId: '',
          kbId: doc.knowledgeBaseId,
          source: 'KB_DOCUMENT',
          previousStatus,
          newStatus,
          reason,
        });
      } else {
        await touchFreshnessCheck(tableName, DOCUMENT_PK, doc[SK_NAME], now);
      }
    } else if (previousStatus !== 'ACTIVE') {
      await clearItemStaleness(tableName, DOCUMENT_PK, doc[SK_NAME], now);
    } else {
      await touchFreshnessCheck(tableName, DOCUMENT_PK, doc[SK_NAME], now);
    }
  }

  return results;
}

// ─── Core Detection: Past Performance Projects ───

async function scanPastProjects(tableName: string): Promise<PastProjectDBItem[]> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const allProjects: PastProjectDBItem[] = [];

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: `${PK_NAME} = :pk`,
        ExpressionAttributeValues: { ':pk': PAST_PROJECT_PK },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const rawItem of scanResult.Items || []) {
      allProjects.push(rawItem as unknown as PastProjectDBItem);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allProjects;
}

export async function detectStalePastProjects(tableName: string, now: Date): Promise<DetectionResult[]> {
  const allProjects = await scanPastProjects(tableName);
  const results: DetectionResult[] = [];

  console.log(`Found ${allProjects.length} past performance projects to check`);

  for (const project of allProjects) {
    if (project.isArchived) continue;

    const previousStatus: FreshnessStatus = project.freshnessStatus || 'ACTIVE';
    if (previousStatus === 'ARCHIVED') continue;

    // Check usage staleness (same logic as KB documents)
    const referenceDate = project.lastUsedAt || project.createdAt;
    const days = daysBetween(referenceDate, now);

    let newStatus: FreshnessStatus = 'ACTIVE';
    let reason: StaleReason | null = null;

    if (days >= FRESHNESS_STALE_DAYS) {
      newStatus = 'STALE';
      reason = 'NOT_USED';
    } else if (days >= FRESHNESS_WARNING_DAYS) {
      newStatus = 'WARNING';
      reason = 'NOT_USED';
    }

    if (newStatus !== previousStatus) {
      if (newStatus === 'ACTIVE') {
        await clearItemStaleness(tableName, PAST_PROJECT_PK, project[SK_NAME], now);
      } else if (reason) {
        await updateItemFreshness(tableName, PAST_PROJECT_PK, project[SK_NAME], newStatus, reason, now);

        const parsed = parsePastProjectSK(project[SK_NAME]);
        if (parsed) {
          results.push({
            itemId: parsed.projectId,
            orgId: parsed.orgId,
            kbId: '',
            source: 'PAST_PERFORMANCE',
            previousStatus,
            newStatus,
            reason,
          });
        }
      }
    } else {
      await touchFreshnessCheck(tableName, PAST_PROJECT_PK, project[SK_NAME], now);
    }
  }

  return results;
}

// ─── Report Generation ───

export async function generateStaleReport(
  tableName: string,
  orgId: string,
  kbId: string | null,
): Promise<StaleContentReportResponse> {
  const now = new Date();

  // Query content library items
  // If kbId is provided, filter to that KB; otherwise, get all items for the org
  const clSkPrefix = kbId ? `${orgId}#${kbId}` : `${orgId}#`;
  const clResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: `${PK_NAME} = :pk AND begins_with(${SK_NAME}, :skPrefix)`,
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':skPrefix': clSkPrefix,
      },
    }),
  );

  // Query KB documents
  // If kbId is provided, filter to that KB; otherwise, skip KB documents (org-level report shows content library only)
  let docResult;
  if (kbId) {
    docResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: `${PK_NAME} = :pk AND begins_with(${SK_NAME}, :skPrefix)`,
        ExpressionAttributeValues: {
          ':pk': DOCUMENT_PK,
          ':skPrefix': `KB#${kbId}`,
        },
      }),
    );
  } else {
    // For org-level report, don't include KB documents (they're KB-specific)
    docResult = { Items: [] };
  }

  // Query Past Performance projects for this org
  const ppResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: `${PK_NAME} = :pk AND begins_with(${SK_NAME}, :skPrefix)`,
      ExpressionAttributeValues: {
        ':pk': PAST_PROJECT_PK,
        ':skPrefix': `${orgId}#`,
      },
    }),
  );

  const clItems = (clResult.Items || []) as unknown as ContentLibraryItem[];
  const docItems = (docResult.Items || []) as unknown as DocumentItem[];
  const ppItems = (ppResult.Items || []) as unknown as PastProjectItem[];

  let active = 0;
  let warning = 0;
  let stale = 0;
  let archived = 0;
  const staleItems: StaleContentReportItem[] = [];
  const warningItems: StaleContentReportItem[] = [];

  // Process content library items
  for (const item of clItems) {
    const status = ((item as Record<string, unknown>).freshnessStatus as FreshnessStatus) || 'ACTIVE';

    if (item.isArchived || status === 'ARCHIVED') { archived++; continue; }

    if (status === 'STALE') {
      stale++;
      staleItems.push({
        item,
        reason: ((item as Record<string, unknown>).staleReason as StaleReason) || 'NOT_USED',
        daysSinceLastUse: daysBetween(item.lastUsedAt || item.createdAt, now),
        certExpired: (item as Record<string, unknown>).staleReason === 'CERT_EXPIRED',
        conflictsWith: null,
      });
    } else if (status === 'WARNING') {
      warning++;
      warningItems.push({
        item,
        reason: ((item as Record<string, unknown>).staleReason as StaleReason) || 'NOT_USED',
        daysSinceLastUse: daysBetween(item.lastUsedAt || item.createdAt, now),
        certExpired: false,
        conflictsWith: null,
      });
    } else {
      active++;
    }
  }

  // Process KB documents — convert to a virtual ContentLibraryItem shape for the report
  for (const doc of docItems) {
    const status = doc.freshnessStatus || 'ACTIVE';
    if (status === 'ARCHIVED') { archived++; continue; }

    const virtualItem = {
      id: doc.id,
      orgId,
      kbId,
      question: `[Document] ${doc.name}`,
      answer: `KB Document: ${doc.name}`,
      category: 'KB Documents',
      tags: [],
      usageCount: 0,
      lastUsedAt: null,
      usedInProjectIds: [],
      currentVersion: 1,
      versions: [],
      isArchived: false,
      archivedAt: null,
      approvalStatus: 'APPROVED' as const,
      approvedBy: null,
      approvedAt: null,
      freshnessStatus: status,
      staleReason: doc.staleReason || null,
      staleSince: doc.staleSince || null,
      lastFreshnessCheck: doc.lastFreshnessCheck || null,
      reactivatedAt: null,
      reactivatedBy: null,
      createdAt: doc.createdAt || now.toISOString(),
      updatedAt: doc.updatedAt || now.toISOString(),
      createdBy: '00000000-0000-0000-0000-000000000000',
    } as unknown as ContentLibraryItem;

    if (status === 'STALE') {
      stale++;
      staleItems.push({
        item: virtualItem,
        reason: doc.staleReason || 'NOT_USED',
        daysSinceLastUse: daysBetween(doc.updatedAt || doc.createdAt, now),
        certExpired: false,
        conflictsWith: null,
      });
    } else if (status === 'WARNING') {
      warning++;
      warningItems.push({
        item: virtualItem,
        reason: doc.staleReason || 'NOT_USED',
        daysSinceLastUse: daysBetween(doc.updatedAt || doc.createdAt, now),
        certExpired: false,
        conflictsWith: null,
      });
    } else {
      active++;
    }
  }

  // Process Past Performance projects
  for (const project of ppItems) {
    if (project.isArchived) { archived++; continue; }

    const status = project.freshnessStatus || 'ACTIVE';
    if (status === 'ARCHIVED') { archived++; continue; }

    const virtualItem = {
      id: project.projectId,
      orgId,
      kbId,
      question: `[Past Performance] ${project.title}`,
      answer: `Past Performance Project: ${project.title} - ${project.client}`,
      category: 'Past Performance',
      tags: project.technologies || [],
      usageCount: project.usageCount || 0,
      lastUsedAt: project.lastUsedAt || null,
      usedInProjectIds: [],
      currentVersion: 1,
      versions: [],
      isArchived: false,
      archivedAt: null,
      approvalStatus: 'APPROVED' as const,
      approvedBy: null,
      approvedAt: null,
      freshnessStatus: status,
      staleReason: project.staleReason || null,
      staleSince: project.staleSince || null,
      lastFreshnessCheck: project.lastFreshnessCheck || null,
      reactivatedAt: project.reactivatedAt || null,
      reactivatedBy: project.reactivatedBy || null,
      createdAt: project.createdAt || now.toISOString(),
      updatedAt: project.updatedAt || now.toISOString(),
      createdBy: project.createdBy || '00000000-0000-0000-0000-000000000000',
    } as unknown as ContentLibraryItem;

    if (status === 'STALE') {
      stale++;
      staleItems.push({
        item: virtualItem,
        reason: project.staleReason || 'NOT_USED',
        daysSinceLastUse: daysBetween(project.lastUsedAt || project.createdAt, now),
        certExpired: false,
        conflictsWith: null,
      });
    } else if (status === 'WARNING') {
      warning++;
      warningItems.push({
        item: virtualItem,
        reason: project.staleReason || 'NOT_USED',
        daysSinceLastUse: daysBetween(project.lastUsedAt || project.createdAt, now),
        certExpired: false,
        conflictsWith: null,
      });
    } else {
      active++;
    }
  }

  // Find latest scan timestamp across all items
  const allChecks = [
    ...clItems.map((i) => (i as Record<string, unknown>).lastFreshnessCheck as string | undefined),
    ...docItems.map((d) => d.lastFreshnessCheck),
    ...ppItems.map((p) => p.lastFreshnessCheck),
  ].filter(Boolean) as string[];

  const lastScanAt = allChecks.length > 0
    ? allChecks.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null;

  return {
    summary: {
      total: clItems.length + docItems.length + ppItems.length,
      active,
      warning,
      stale,
      archived,
    },
    staleItems,
    warningItems,
    lastScanAt,
  };
}
