#!/usr/bin/env tsx
/**
 * Script to wire auditMiddleware + setAuditContext into REST Lambda handlers.
 * Run: cd /Users/yevhenii/Work/HORUSTECH/auto_rfp && npx tsx scripts/wire-audit-middleware.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = '/Users/yevhenii/Work/HORUSTECH/auto_rfp/apps/functions/src/handlers';

interface HandlerConfig {
  file: string;
  action: string;
  resource: string;
  resourceIdExpr: string; // JS expression to get resourceId from the handler context
  successReturnPattern: string; // unique string near the success return to insert setAuditContext before
}

const handlers: HandlerConfig[] = [
  // document
  {
    file: 'document/create-document.ts',
    action: 'DOCUMENT_UPLOADED',
    resource: 'document',
    resourceIdExpr: "newDocument.id ?? 'unknown'",
    successReturnPattern: 'return apiResponse(201, newDocument)',
  },
  {
    file: 'document/delete-document.ts',
    action: 'DOCUMENT_DELETED',
    resource: 'document',
    resourceIdExpr: 'dto.id',
    successReturnPattern: 'return apiResponse(200, {',
  },
  // organization
  {
    file: 'organization/create-organization.ts',
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'organization',
    resourceIdExpr: "newOrganization.id ?? 'unknown'",
    successReturnPattern: 'return apiResponse(201, newOrganization)',
  },
  {
    file: 'organization/edit-organization.ts',
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'organization',
    resourceIdExpr: "event.pathParameters?.orgId ?? event.queryStringParameters?.orgId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'organization/delete-organization.ts',
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'organization',
    resourceIdExpr: "event.pathParameters?.orgId ?? event.queryStringParameters?.orgId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // knowledgebase
  {
    file: 'knowledgebase/create-knowledgebase.ts',
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'knowledge_base',
    resourceIdExpr: "'knowledgebase'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'knowledgebase/delete-knowledgebase.ts',
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'knowledge_base',
    resourceIdExpr: "event.pathParameters?.kbId ?? event.queryStringParameters?.kbId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'knowledgebase/grant-kb-access.ts',
    action: 'ORG_MEMBER_ADDED',
    resource: 'knowledge_base',
    resourceIdExpr: "event.pathParameters?.kbId ?? event.queryStringParameters?.kbId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'knowledgebase/revoke-kb-access.ts',
    action: 'ORG_MEMBER_REMOVED',
    resource: 'knowledge_base',
    resourceIdExpr: "event.pathParameters?.kbId ?? event.queryStringParameters?.kbId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // templates
  {
    file: 'templates/create-template.ts',
    action: 'CONFIG_CHANGED',
    resource: 'template',
    resourceIdExpr: "'template'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'templates/delete-template.ts',
    action: 'CONFIG_CHANGED',
    resource: 'template',
    resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'templates/update-template.ts',
    action: 'CONFIG_CHANGED',
    resource: 'template',
    resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'templates/publish-template.ts',
    action: 'CONFIG_CHANGED',
    resource: 'template',
    resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'templates/apply-template.ts',
    action: 'CONFIG_CHANGED',
    resource: 'template',
    resourceIdExpr: "event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // export
  {
    file: 'export/generate-batch.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-html.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-md.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-pdf.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-pptx.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-txt.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'export/generate-word.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.queryStringParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // rfp-document
  {
    file: 'rfp-document/create-rfp-document.ts',
    action: 'PROPOSAL_SUBMITTED',
    resource: 'proposal',
    resourceIdExpr: "'rfp-document'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'rfp-document/delete-rfp-document.ts',
    action: 'DATA_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'rfp-document/export-rfp-document.ts',
    action: 'PROPOSAL_EXPORTED',
    resource: 'proposal',
    resourceIdExpr: "event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // samgov api keys
  {
    file: 'samgov/set-api-key.ts',
    action: 'API_KEY_CREATED',
    resource: 'api_key',
    resourceIdExpr: "'samgov-api-key'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'samgov/delete-api-key.ts',
    action: 'API_KEY_DELETED',
    resource: 'api_key',
    resourceIdExpr: "'samgov-api-key'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // user org management
  {
    file: 'user/add-to-organization.ts',
    action: 'ORG_MEMBER_ADDED',
    resource: 'user',
    resourceIdExpr: "event.pathParameters?.userId ?? event.queryStringParameters?.userId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'user/remove-from-organization.ts',
    action: 'ORG_MEMBER_REMOVED',
    resource: 'user',
    resourceIdExpr: "event.pathParameters?.userId ?? event.queryStringParameters?.userId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // prompt
  {
    file: 'prompt/save-prompt.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "'prompt'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // debriefing
  {
    file: 'debriefing/create-debriefing.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "'debriefing'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'debriefing/update-debriefing.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "event.pathParameters?.debriefingId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // foia
  {
    file: 'foia/create-foia-request.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "'foia-request'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'foia/update-foia-request.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "event.pathParameters?.requestId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  // pastperf
  {
    file: 'pastperf/create-project.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "'pastperf-project'",
    successReturnPattern: 'return apiResponse(201,',
  },
  {
    file: 'pastperf/delete-project.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "event.pathParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
  {
    file: 'pastperf/update-project.ts',
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceIdExpr: "event.pathParameters?.projectId ?? 'unknown'",
    successReturnPattern: 'return apiResponse(200,',
  },
];

const AUDIT_IMPORT = `import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';`;
const AUTHED_EVENT_TYPE = `type AuthedEvent,`;

let processed = 0;
let skipped = 0;
let errors = 0;

for (const h of handlers) {
  const filePath = join(BASE, h.file);
  try {
    let content = readFileSync(filePath, 'utf-8');

    // Skip if already has auditMiddleware
    if (content.includes('auditMiddleware')) {
      console.log(`⏭  SKIP (already done): ${h.file}`);
      skipped++;
      continue;
    }

    // 1. Add audit import after rbac-middleware import block
    if (!content.includes(AUDIT_IMPORT)) {
      content = content.replace(
        /} from '@\/middleware\/rbac-middleware';/,
        `} from '@/middleware/rbac-middleware';\n${AUDIT_IMPORT}`,
      );
    }

    // 2. Add AuthedEvent to rbac import if not present
    if (!content.includes('type AuthedEvent')) {
      content = content.replace(
        /requirePermission\n\} from '@\/middleware\/rbac-middleware';/,
        `requirePermission,\n  type AuthedEvent,\n} from '@/middleware/rbac-middleware';`,
      );
      // Also handle single-line import
      content = content.replace(
        /requirePermission\s*\n\} from '@\/middleware\/rbac-middleware';/,
        `requirePermission,\n  type AuthedEvent,\n} from '@/middleware/rbac-middleware';`,
      );
      // Handle comma-less last item
      content = content.replace(
        /(requirePermission)(\s*\n\} from '@\/middleware\/rbac-middleware';)/,
        `$1,\n  type AuthedEvent$2`,
      );
    }

    // 3. Change baseHandler event type from APIGatewayProxyEventV2 to AuthedEvent
    content = content.replace(
      /export const baseHandler = async \(\s*event: APIGatewayProxyEventV2,/,
      'export const baseHandler = async (\n  event: AuthedEvent,',
    );

    // 4. Add setAuditContext before the first success return
    const setAuditCall = `\n    setAuditContext(event, {\n      action: '${h.action}',\n      resource: '${h.resource}',\n      resourceId: ${h.resourceIdExpr},\n    });\n\n    `;
    const returnIdx = content.indexOf(h.successReturnPattern);
    if (returnIdx !== -1) {
      content = content.slice(0, returnIdx) + setAuditCall + content.slice(returnIdx);
    } else {
      console.warn(`  ⚠️  Could not find success return pattern in ${h.file}: "${h.successReturnPattern}"`);
    }

    // 5. Add auditMiddleware() before httpErrorMiddleware()
    content = content.replace(
      /\.use\(httpErrorMiddleware\(\)\)/,
      '.use(auditMiddleware())\n    .use(httpErrorMiddleware())',
    );

    // 6. Fix trailing comma on handler export
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
