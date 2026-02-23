#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = '/Users/yevhenii/Work/HORUSTECH/auto_rfp/apps/functions/src/handlers';

interface HandlerConfig {
  file: string;
  action: string;
  resource: string;
  resourceIdExpr: string;
  successReturnPattern: string;
}

const handlers: HandlerConfig[] = [
  { file: 'document/edit-document.ts', action: 'DOCUMENT_VIEWED', resource: 'document', resourceIdExpr: "event.pathParameters?.id ?? event.queryStringParameters?.id ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'document/download-document.ts', action: 'DOCUMENT_VIEWED', resource: 'document', resourceIdExpr: "event.pathParameters?.id ?? event.queryStringParameters?.id ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'document/start-document-pipeline.ts', action: 'PIPELINE_STARTED', resource: 'pipeline', resourceIdExpr: "event.pathParameters?.id ?? event.queryStringParameters?.id ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'knowledgebase/edit-knowledgebase.ts', action: 'ORG_SETTINGS_CHANGED', resource: 'knowledge_base', resourceIdExpr: "event.pathParameters?.kbId ?? event.queryStringParameters?.kbId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'project/link-kb.ts', action: 'ORG_SETTINGS_CHANGED', resource: 'knowledge_base', resourceIdExpr: "event.pathParameters?.projectId ?? event.queryStringParameters?.projectId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'project/unlink-kb.ts', action: 'ORG_SETTINGS_CHANGED', resource: 'knowledge_base', resourceIdExpr: "event.pathParameters?.projectId ?? event.queryStringParameters?.projectId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'project-outcome/set-outcome.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.projectId ?? event.queryStringParameters?.projectId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'question/delete-question.ts', action: 'ANSWER_DELETED', resource: 'question', resourceIdExpr: "event.pathParameters?.questionId ?? event.queryStringParameters?.questionId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'question-file/create-question-file.ts', action: 'DOCUMENT_UPLOADED', resource: 'document', resourceIdExpr: "'question-file'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'question-file/delete-question-file.ts', action: 'DOCUMENT_DELETED', resource: 'document', resourceIdExpr: "event.pathParameters?.id ?? event.queryStringParameters?.id ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'templates/clone-template.ts', action: 'CONFIG_CHANGED', resource: 'template', resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'templates/import-template.ts', action: 'CONFIG_CHANGED', resource: 'template', resourceIdExpr: "'template'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'templates/restore-template-version.ts', action: 'CONFIG_CHANGED', resource: 'template', resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'opportunity/create-opportunity.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'opportunity'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'opportunity/delete-opportunity.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.opportunityId ?? event.queryStringParameters?.opportunityId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'opportunity/update-opportunity.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.opportunityId ?? event.queryStringParameters?.opportunityId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'opportunity-context/upsert-context-override.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'opportunity-context'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'opportunity-context/remove-context-override.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'opportunity-context'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'samgov/create-saved-search.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'saved-search'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'samgov/delete-saved-search.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.searchId ?? event.queryStringParameters?.searchId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'samgov/edit-saved-search.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.searchId ?? event.queryStringParameters?.searchId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'samgov/import-solicitation.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'solicitation'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'google/set-api-key.ts', action: 'API_KEY_CREATED', resource: 'api_key', resourceIdExpr: "'google-api-key'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'linear/save-api-key.ts', action: 'API_KEY_CREATED', resource: 'api_key', resourceIdExpr: "'linear-api-key'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'rfp-document/generate-document.ts', action: 'PROPOSAL_SUBMITTED', resource: 'proposal', resourceIdExpr: "event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'rfp-document/sync-to-google-drive.ts', action: 'DATA_EXPORTED', resource: 'proposal', resourceIdExpr: "event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'answer/generate-answer.ts', action: 'ANSWER_GENERATED', resource: 'answer', resourceIdExpr: "event.queryStringParameters?.questionId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'brief/init-executive-brief.ts', action: 'AI_GENERATION_STARTED', resource: 'pipeline', resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'clustering/apply-cluster-answer.ts', action: 'ANSWER_EDITED', resource: 'answer', resourceIdExpr: "event.queryStringParameters?.clusterId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'collaboration/create-comment.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'comment'", successReturnPattern: 'return apiResponse(201,' },
  { file: 'collaboration/delete-comment.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.commentId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'collaboration/update-comment.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "event.pathParameters?.commentId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'collaboration/upsert-assignment.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'assignment'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'deadlines/regenerate-calendar-subscription.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'calendar-subscription'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'deadlines/revoke-calendar-subscription.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'calendar-subscription'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'organization/upload-icon.ts', action: 'ORG_SETTINGS_CHANGED', resource: 'organization', resourceIdExpr: "event.pathParameters?.orgId ?? event.queryStringParameters?.orgId ?? 'unknown'", successReturnPattern: 'return apiResponse(200,' },
  { file: 'notification/update-preferences.ts', action: 'CONFIG_CHANGED', resource: 'config', resourceIdExpr: "'notification-preferences'", successReturnPattern: 'return apiResponse(200,' },
];

const AUDIT_IMPORT = `import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';`;

let processed = 0;
let skipped = 0;
let errors = 0;

for (const h of handlers) {
  const filePath = join(BASE, h.file);
  try {
    let content = readFileSync(filePath, 'utf-8');

    if (content.includes('auditMiddleware')) {
      console.log(`⏭  SKIP: ${h.file}`);
      skipped++;
      continue;
    }

    // 1. Add AuthedEvent to rbac import
    if (!content.includes('type AuthedEvent')) {
      content = content.replace(
        /  requirePermission,?\n\} from '@\/middleware\/rbac-middleware';/,
        `  requirePermission,\n  type AuthedEvent,\n} from '@/middleware/rbac-middleware';`,
      );
    }

    // 2. Add audit import after rbac import
    if (!content.includes(AUDIT_IMPORT)) {
      content = content.replace(
        /\} from '@\/middleware\/rbac-middleware';/,
        `} from '@/middleware/rbac-middleware';\n${AUDIT_IMPORT}`,
      );
    }

    // 3. Change baseHandler event type
    content = content.replace(
      /export const baseHandler = async \(\s*event: APIGatewayProxyEventV2[^,)]*,/,
      'export const baseHandler = async (\n  event: AuthedEvent,',
    );
    // Also handle arrow function without explicit type annotation
    content = content.replace(
      /const baseHandler = async \(\s*event: APIGatewayProxyEventV2[^,)]*,/,
      'const baseHandler = async (\n  event: AuthedEvent,',
    );

    // 4. Add setAuditContext before success return
    const setAuditCall = `\n    setAuditContext(event, {\n      action: '${h.action}',\n      resource: '${h.resource}',\n      resourceId: ${h.resourceIdExpr},\n    });\n\n    `;
    const returnIdx = content.indexOf(h.successReturnPattern);
    if (returnIdx !== -1) {
      content = content.slice(0, returnIdx) + setAuditCall + content.slice(returnIdx);
    } else {
      console.warn(`  ⚠️  Pattern not found in ${h.file}: "${h.successReturnPattern}"`);
    }

    // 5. Add auditMiddleware before httpErrorMiddleware
    content = content.replace(
      /\.use\(httpErrorMiddleware\(\)\)/,
      '.use(auditMiddleware())\n    .use(httpErrorMiddleware())',
    );

    // 6. Fix trailing comma
    content = content.replace(
      /\.use\(httpErrorMiddleware\(\)\)\s*\);/,
      '.use(httpErrorMiddleware()),\n);',
    );

    writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ DONE: ${h.file}`);
    processed++;
  } catch (err) {
    console.error(`❌ ERROR: ${h.file}`, err);
    errors++;
  }
}

console.log(`\nSummary: ${processed} processed, ${skipped} skipped, ${errors} errors`);
