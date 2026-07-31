/**
 * Claude tool-use definitions and executor for AI Compliance Review.
 *
 * The model pulls only what it needs on demand (keeping the sync-chat prompt
 * bounded under the 29s limit) via these tools:
 *   - list_package_documents → RFP documents (ids/titles/headings) + required forms
 *   - get_document_section   → bounded section text of one RFP document
 *   - get_form_fields        → real fieldIds/labels/values of one required form
 *   - search_solicitation    → semantic search over solicitation chunks (citations)
 *
 * The same inventory the tools expose is also used by
 * compliance-review-validate.ts to verify finding anchors — so the model can
 * only reference real headings/cells/fields, never fabricate them.
 */
import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { searchSolicitation } from '@/helpers/pinecone';
import { truncateText } from '@/helpers/executive-opportunity-brief';
import { listRFPDocumentsByProject, loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { listRequiredFormsByOpportunity } from '@/helpers/required-form';
import { extractHeadings, getSectionText } from '@/helpers/compliance-review-html';
import {
  MAX_SECTION_CHARS,
  MAX_FORM_FIELDS_RETURNED,
  MAX_FORM_FIELD_VALUE_CHARS,
} from '@/constants/compliance-review';
import type { ToolDefinition, ToolResult } from '@/types/tool';
import type { ChatSourceCitation, ComplianceTargetKind } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const EXCERPT_MAX_CHARS = 500;

// ─── Package inventory (shared by tools + anchor validation) ────────────────

export interface DocumentInventory {
  documentId: string;
  title: string;
  targetKind: ComplianceTargetKind;
  headings: string[];
  htmlContentKey?: string;
}

export interface FormFieldInventory {
  fieldId: string;
  label: string;
  value: string | null;
}

export interface FormInventory {
  formId: string;
  name: string;
  targetKind: ComplianceTargetKind;
  fields: FormFieldInventory[];
}

export interface PackageInventory {
  documents: DocumentInventory[];
  forms: FormInventory[];
}

/** Map a required-form formType to a finding target kind. */
const formTargetKind = (formType: string): ComplianceTargetKind => {
  if (formType === 'XLSX_MATRIX' || formType === 'XLSX_FORM') return 'XLSX_FORM';
  return 'PDF_FORM'; // PDF_FILLABLE, PDF_SCANNED, DOCX_FORM, CONTRACT_TEMPLATE
};

/**
 * Build the full package inventory once per review. Loads document HTML to
 * extract headings so anchors are validatable. Bounded by the number of docs
 * in a package (small).
 */
export const buildPackageInventory = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
}): Promise<PackageInventory> => {
  const { orgId, projectId, oppId } = args;

  const [docsRes, forms] = await Promise.all([
    listRFPDocumentsByProject({ projectId, opportunityId: oppId }),
    listRequiredFormsByOpportunity({ orgId, projectId, opportunityId: oppId }),
  ]);

  const documents: DocumentInventory[] = await Promise.all(
    docsRes.items.map(async (doc): Promise<DocumentInventory> => {
      const htmlContentKey = doc.htmlContentKey as string | undefined;
      let headings: string[] = [];
      if (htmlContentKey) {
        try {
          const html = await loadRFPDocumentHtml(htmlContentKey);
          headings = extractHeadings(html);
        } catch (err) {
          console.warn(`[compliance-review-tools] failed to load HTML for ${doc.documentId}:`, (err as Error)?.message);
        }
      }
      return {
        documentId: doc.documentId as string,
        title: (doc.title as string) ?? (doc.name as string) ?? 'Untitled',
        targetKind: 'RFP_DOCUMENT',
        headings,
        htmlContentKey,
      };
    }),
  );

  const formInventory: FormInventory[] = forms.map((form) => ({
    formId: form.formId,
    name: form.name,
    targetKind: formTargetKind(form.formType),
    fields: (form.fields ?? []).map((f) => ({ fieldId: f.fieldId, label: f.label, value: f.value })),
  }));

  return { documents, forms: formInventory };
};

// ─── Tool definitions ───────────────────────────────────────────────────────

export const COMPLIANCE_REVIEW_TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: 'list_package_documents',
    description:
      'List every document in the submission package: RFP documents (with their section headings) ' +
      'and required forms. Call this FIRST to see what the package contains before drilling in. ' +
      'Use the exact heading strings returned here as anchors, and the exact formId/fieldId for form findings.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_document_section',
    description:
      'Get the plain-text content of one section of an RFP document, addressed by its documentId and ' +
      'the exact heading string from list_package_documents. Use this to read what a section actually says.',
    input_schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The RFP document id.' },
        heading: { type: 'string', description: 'Exact heading text from list_package_documents.' },
      },
      required: ['documentId', 'heading'],
    },
  },
  {
    name: 'get_form_fields',
    description:
      'Get the fields (fieldId, label, current value) of one required form, addressed by formId. ' +
      'Use this to check form values and to reference a specific field (by fieldId) in a finding. ' +
      'Large forms (e.g. wide XLSX matrices) are capped; when you are looking for a specific kind of ' +
      'field (e.g. a phone number, a price, a date), pass labelFilter to return only fields whose ' +
      'label or value contains that text — this is both faster and avoids the cap.',
    input_schema: {
      type: 'object',
      properties: {
        formId: { type: 'string', description: 'The required-form id from list_package_documents.' },
        labelFilter: {
          type: 'string',
          description:
            'Optional case-insensitive substring; only fields whose label or value contains it are returned.',
        },
      },
      required: ['formId'],
    },
  },
  {
    name: 'search_solicitation',
    description:
      'Semantic search over the solicitation/RFP documents. Use this to find the requirements, ' +
      'Section L/M instructions, evaluation criteria, and submission rules the package must satisfy. ' +
      'Returns excerpts you can cite as solicitationRefs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What requirement or instruction to look for.' },
        limit: { type: 'number', description: 'Max excerpts (1–8). Default 5.' },
      },
      required: ['query'],
    },
  },
] as const;

// ─── Tool executor ──────────────────────────────────────────────────────────

/**
 * Build the executor bound to a specific package. Reuses the pre-built
 * inventory so list_package_documents / get_form_fields don't re-query.
 */
export const makeComplianceToolExecutor = (ctx: {
  orgId: string;
  oppId: string;
  inventory: PackageInventory;
}) => {
  const { orgId, oppId, inventory } = ctx;

  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string,
  ): Promise<ToolResult> => {
    try {
      switch (toolName) {
        case 'list_package_documents': {
          const docLines = inventory.documents.map(
            (d) =>
              `- documentId=${d.documentId} | "${d.title}" | headings: ${d.headings.length ? d.headings.map((h) => `"${h}"`).join(', ') : '(none)'}`,
          );
          const formLines = inventory.forms.map(
            (f) => `- formId=${f.formId} | "${f.name}" | ${f.fields.length} field(s)`,
          );
          const content =
            `RFP DOCUMENTS (${inventory.documents.length}):\n${docLines.join('\n') || '(none)'}\n\n` +
            `REQUIRED FORMS (${inventory.forms.length}):\n${formLines.join('\n') || '(none)'}`;
          return { tool_use_id: toolUseId, content };
        }

        case 'get_document_section': {
          const documentId = String(toolInput.documentId ?? '');
          const heading = String(toolInput.heading ?? '');
          const doc = inventory.documents.find((d) => d.documentId === documentId);
          if (!doc || !doc.htmlContentKey) {
            return { tool_use_id: toolUseId, content: `No RFP document with id ${documentId}.` };
          }
          const html = await loadRFPDocumentHtml(doc.htmlContentKey);
          const section = getSectionText(html, heading, MAX_SECTION_CHARS);
          return {
            tool_use_id: toolUseId,
            content: section || `Section "${heading}" is empty or was not found in "${doc.title}".`,
          };
        }

        case 'get_form_fields': {
          const formId = String(toolInput.formId ?? '');
          const form = inventory.forms.find((f) => f.formId === formId);
          if (!form) return { tool_use_id: toolUseId, content: `No required form with id ${formId}.` };

          // Optional label/value substring filter — lets the model ask for just
          // the phone/price/date fields instead of pulling the whole matrix.
          const rawFilter = typeof toolInput.labelFilter === 'string' ? toolInput.labelFilter.trim() : '';
          const filter = rawFilter.toLowerCase();
          const matched = filter
            ? form.fields.filter(
                (f) =>
                  f.label.toLowerCase().includes(filter) ||
                  (f.value ?? '').toLowerCase().includes(filter),
              )
            : form.fields;

          // Cap the number of fields returned. A wide XLSX matrix can carry
          // thousands of fields; dumping them all overflowed Bedrock's 200k-token
          // prompt limit. The model can re-query with a narrower labelFilter.
          const shown = matched.slice(0, MAX_FORM_FIELDS_RETURNED);
          const lines = shown.map(
            (f) =>
              `- fieldId=${f.fieldId} | "${f.label}" | value: ${
                f.value ? truncateText(f.value, MAX_FORM_FIELD_VALUE_CHARS) : '(empty)'
              }`,
          );

          const header = filter
            ? `Form "${form.name}" fields matching "${rawFilter}" (${matched.length} of ${form.fields.length}):`
            : `Form "${form.name}" fields (${form.fields.length}):`;
          const omitted = matched.length - shown.length;
          const footer =
            omitted > 0
              ? `\n… ${omitted} more field(s) not shown — narrow with labelFilter to see specific fields.`
              : '';

          return {
            tool_use_id: toolUseId,
            content: `${header}\n${lines.join('\n') || '(no matching fields)'}${footer}`,
          };
        }

        case 'search_solicitation': {
          const query = String(toolInput.query ?? '');
          const limit = typeof toolInput.limit === 'number' ? Math.min(Math.max(toolInput.limit, 1), 8) : 5;
          const hits = await searchSolicitation(orgId, oppId, query, limit);
          if (!hits.length) {
            return { tool_use_id: toolUseId, content: 'No solicitation content matched that query.' };
          }
          const sources: ChatSourceCitation[] = [];
          const parts = await Promise.all(
            hits.map(async (hit, i) => {
              const bucket = hit.metadata.bucket || DOCUMENTS_BUCKET;
              const text = await loadTextFromS3(bucket, hit.metadata.chunkKey).catch(() => '');
              if (!text.trim()) return null;
              sources.push({
                sourceId: `sol-${i}`,
                questionFileId: hit.metadata.questionFileId,
                fileName: hit.metadata.fileName,
                chunkIndex: hit.metadata.chunkIndex,
                excerpt: truncateText(text, EXCERPT_MAX_CHARS),
                relevance: Math.max(0, Math.min(1, hit.score ?? 0)),
              });
              return `[Source ${i + 1}: ${hit.metadata.fileName}]\n${truncateText(text, 1500)}`;
            }),
          );
          const valid = parts.filter((p): p is string => p !== null);
          return {
            tool_use_id: toolUseId,
            content: valid.length ? valid.join('\n\n---\n\n') : 'Could not load solicitation content.',
            sources: sources.map((s) => ({
              id: s.sourceId,
              fileName: s.fileName,
              relevance: s.relevance,
              textContent: s.excerpt,
            })),
          };
        }

        default:
          return { tool_use_id: toolUseId, content: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      const message = (err as Error)?.message ?? 'Unknown error';
      console.error(`[compliance-review-tools] tool "${toolName}" failed:`, message);
      return { tool_use_id: toolUseId, content: `Error executing tool "${toolName}": ${message}` };
    }
  };
};
