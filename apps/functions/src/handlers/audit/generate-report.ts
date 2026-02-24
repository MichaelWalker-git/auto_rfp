import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GenerateReportSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { queryAuditLogs } from '@/helpers/audit-log';
import { nowIso } from '@/helpers/date';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import type { AuditLogEntry } from '@auto-rfp/core';

// ─── Report builders ──────────────────────────────────────────────────────────

const buildUserActivitySummary = (logs: AuditLogEntry[]) => {
  const byUser: Record<string, { userId: string; userName: string; actionCount: number; lastSeen: string }> = {};
  for (const log of logs) {
    const existing = byUser[log.userId];
    if (!existing) {
      byUser[log.userId] = { userId: log.userId, userName: log.userName, actionCount: 1, lastSeen: log.timestamp };
    } else {
      existing.actionCount++;
      if (log.timestamp > existing.lastSeen) existing.lastSeen = log.timestamp;
    }
  }
  return Object.values(byUser).sort((a, b) => b.actionCount - a.actionCount);
};

const buildAccessReport = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS'].includes(l.action));

const buildChangeHistory = (logs: AuditLogEntry[]) =>
  logs.filter((l) => l.changes !== undefined);

const buildSecurityEvents = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['USER_LOGIN_FAILED', 'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS', 'API_KEY_CREATED', 'API_KEY_DELETED', 'PERMISSION_CHANGED', 'CONFIG_CHANGED'].includes(l.action));

const buildExportLog = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['DATA_EXPORTED', 'DOCUMENT_EXPORTED', 'PROPOSAL_EXPORTED', 'REPORT_GENERATED'].includes(l.action));

/**
 * Neutralize CSV formula injection (CWE-1236 / OWASP CSV Injection).
 * Cells starting with =, +, -, @, TAB, or CR are prefixed with a single quote
 * so spreadsheet applications treat them as plain text, not formulas.
 * The value is then double-quote wrapped with internal quotes escaped.
 */
const sanitizeCsvCell = (v: unknown): string => {
  const raw = String(v ?? '');
  // Prefix formula-triggering characters with a tab to neutralize them.
  // Using \t prefix is the OWASP-recommended approach that preserves readability.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;
  // Wrap in double quotes and escape any internal double quotes
  return `"${safe.replace(/"/g, '""')}"`;
};

const toCsv = (rows: AuditLogEntry[]): string => {
  if (rows.length === 0) return '';
  const headers: (keyof AuditLogEntry)[] = ['logId', 'timestamp', 'userId', 'userName', 'organizationId', 'action', 'resource', 'resourceId', 'result', 'ipAddress', 'userAgent', 'errorMessage'];
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => sanitizeCsvCell(r[h])).join(',')),
  ].join('\n');
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = GenerateReportSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // Fetch all logs in the date range (paginate internally)
  const allLogs: AuditLogEntry[] = [];
  let nextToken: string | undefined;
  do {
    const result = await queryAuditLogs({
      orgId: data.orgId,
      userId: data.userId,
      fromDate: data.fromDate,
      toDate: data.toDate,
      limit: 200,
      nextToken,
    });
    allLogs.push(...result.items);
    nextToken = result.nextToken;
  } while (nextToken);

  let reportData: unknown;
  switch (data.reportType) {
    case 'user_activity_summary': reportData = buildUserActivitySummary(allLogs); break;
    case 'access_report':         reportData = buildAccessReport(allLogs); break;
    case 'change_history':        reportData = buildChangeHistory(allLogs); break;
    case 'security_events':       reportData = buildSecurityEvents(allLogs); break;
    case 'export_log':            reportData = buildExportLog(allLogs); break;
  }

  const rowCount = Array.isArray(reportData) ? reportData.length : 0;

  if (data.format === 'csv') {
    const csvData = toCsv(Array.isArray(reportData) ? reportData as AuditLogEntry[] : allLogs);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-report-${data.reportType}-${data.fromDate.slice(0, 10)}.csv"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: csvData,
    };
  }

  return apiResponse(200, {
    reportType: data.reportType,
    orgId: data.orgId,
    fromDate: data.fromDate,
    toDate: data.toDate,
    generatedAt: nowIso(),
    format: data.format,
    data: reportData,
    rowCount,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('audit:report'))
    .use(httpErrorMiddleware()),
);
