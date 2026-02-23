import { z } from 'zod';

// ─── Audit Action Categories ──────────────────────────────────────────────────

export const AuditActionSchema = z.enum([
  // User actions
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'USER_ROLE_CHANGED',
  'USER_INVITED',
  // Document actions
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DELETED',
  'DOCUMENT_EXPORTED',
  'DOCUMENT_VIEWED',
  // Answer actions
  'ANSWER_CREATED',
  'ANSWER_EDITED',
  'ANSWER_DELETED',
  'ANSWER_GENERATED',
  // Proposal actions
  'PROPOSAL_SUBMITTED',
  'PROPOSAL_EXPORTED',
  // Project actions
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  // Organization actions
  'ORG_SETTINGS_CHANGED',
  'ORG_MEMBER_ADDED',
  'ORG_MEMBER_REMOVED',
  // Permission / security actions
  'PERMISSION_DENIED',
  'UNAUTHORIZED_ACCESS',
  'API_KEY_CREATED',
  'API_KEY_DELETED',
  'PERMISSION_CHANGED',
  // System / pipeline events
  'PIPELINE_STARTED',
  'PIPELINE_COMPLETED',
  'PIPELINE_FAILED',
  'AI_GENERATION_STARTED',
  'AI_GENERATION_COMPLETED',
  'AI_GENERATION_FAILED',
  'INTEGRATION_SYNC_STARTED',
  'INTEGRATION_SYNC_COMPLETED',
  'INTEGRATION_SYNC_FAILED',
  // Export / data operations
  'DATA_EXPORTED',
  'REPORT_GENERATED',
  // Configuration
  'CONFIG_CHANGED',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

// ─── Audit Resource Types ─────────────────────────────────────────────────────

export const AuditResourceSchema = z.enum([
  'user',
  'organization',
  'project',
  'document',
  'answer',
  'question',
  'proposal',
  'knowledge_base',
  'template',
  'api_key',
  'permission',
  'pipeline',
  'report',
  'config',
  'system',
]);
export type AuditResource = z.infer<typeof AuditResourceSchema>;

// ─── Audit Log Entry (stored in DynamoDB) ─────────────────────────────────────

export const AuditLogEntrySchema = z.object({
  logId: z.string().uuid(),
  timestamp: z.string().datetime(),
  userId: z.string().min(1),           // 'system' for automated events
  userName: z.string().min(1),         // display name or 'system'
  organizationId: z.string().min(1),   // 'global' for cross-org system events
  action: AuditActionSchema,
  resource: AuditResourceSchema,
  resourceId: z.string().min(1),       // ID of the affected entity
  changes: z.object({
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  }).optional(),
  ipAddress: z.string().min(1),        // '0.0.0.0' for system events
  userAgent: z.string().min(1),        // 'system' for automated events
  result: z.enum(['success', 'failure']),
  errorMessage: z.string().optional(),
  /** SHA-256 HMAC of the log entry for tamper detection */
  integrityHash: z.string().min(1),
  /** DynamoDB TTL — Unix epoch seconds, 90 days from creation */
  ttl: z.number().int().positive(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ─── SQS Payload (what gets enqueued by the middleware) ───────────────────────

export const AuditLogPayloadSchema = AuditLogEntrySchema.omit({
  integrityHash: true,
  ttl: true,
});
export type AuditLogPayload = z.infer<typeof AuditLogPayloadSchema>;

// ─── Query DTOs ───────────────────────────────────────────────────────────────

export const QueryAuditLogsSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().optional(),
  action: AuditActionSchema.optional(),
  resource: AuditResourceSchema.optional(),
  resourceId: z.string().optional(),
  result: z.enum(['success', 'failure']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  nextToken: z.string().optional(),
});
export type QueryAuditLogs = z.infer<typeof QueryAuditLogsSchema>;

// ─── Report DTOs ──────────────────────────────────────────────────────────────

export const ReportTypeSchema = z.enum([
  'user_activity_summary',
  'access_report',
  'change_history',
  'security_events',
  'export_log',
]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

export const GenerateReportSchema = z.object({
  orgId: z.string().min(1),
  reportType: ReportTypeSchema,
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  userId: z.string().optional(),       // scope report to a specific user
  format: z.enum(['json', 'csv']).default('json'),
});
export type GenerateReport = z.infer<typeof GenerateReportSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const AuditLogsResponseSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  count: z.number(),
  nextToken: z.string().optional(),
});
export type AuditLogsResponse = z.infer<typeof AuditLogsResponseSchema>;

export const GenerateReportResponseSchema = z.object({
  reportType: ReportTypeSchema,
  orgId: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  generatedAt: z.string(),
  format: z.enum(['json', 'csv']),
  data: z.unknown(),                   // typed per report in the handler
  rowCount: z.number(),
});
export type GenerateReportResponse = z.infer<typeof GenerateReportResponseSchema>;
