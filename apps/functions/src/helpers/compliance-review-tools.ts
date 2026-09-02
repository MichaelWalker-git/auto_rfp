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
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { listRequiredFormsByOpportunity } from '@/helpers/required-form';
import { extractHeadings, getSectionText } from '@/helpers/compliance-review-html';
import {
  loadCompanyFacts,
  loadCertRecords,
  searchKnowledgeBase,
  searchPastPerformanceUsable,
  loadSolutionPlanFacts,
} from '@/helpers/compliance-truth-sources';
import { getLinkedKBIds } from '@/helpers/project-kb';
import {
  readQuestionnaireCellInventory,
  type QuestionnaireCellInventory,
} from '@/helpers/compliance-review-xlsx';
import {
  MAX_SECTION_CHARS,
  MAX_FORM_FIELDS_RETURNED,
  MAX_FORM_FIELD_VALUE_CHARS,
  MAX_QUESTIONNAIRE_CELLS_RETURNED,
  FACTUAL_KB_TOP_K,
  FACTUAL_PP_TOP_K,
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
  /** First-sheet cells of an XLSX questionnaire (documentType QUESTIONNAIRE, file-based). */
  questionnaireCells?: QuestionnaireCellInventory;
  /** S3 key of the XLSX questionnaire file — lets the EDIT engine re-read FULL
   *  (untruncated) cell values for recall + apply, which the truncated review
   *  `questionnaireCells` can't provide. */
  fileKey?: string;
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
 * Whether an RFP document is a file-based XLSX questionnaire (documentType
 * QUESTIONNAIRE with an .xlsx/.xls file and no HTML). Mirrors the frontend
 * `isXlsxQuestionnaire`. HTML questionnaires (from DOCX/PDF) carry an
 * htmlContentKey and are reviewed as normal RFP documents.
 */
const isXlsxQuestionnaireDoc = (doc: Record<string, unknown>): boolean => {
  if (doc.documentType !== 'QUESTIONNAIRE') return false;
  if (doc.htmlContentKey) return false;
  const name = String((doc.originalFileName as string) ?? (doc.fileKey as string) ?? '').toLowerCase();
  return !!doc.fileKey && (name.endsWith('.xlsx') || name.endsWith('.xls'));
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
      const title = (doc.title as string) ?? (doc.name as string) ?? 'Untitled';

      // XLSX questionnaire: no HTML/headings — read the first sheet's cells so
      // the model can review the answers and cell anchors can be validated.
      if (isXlsxQuestionnaireDoc(doc)) {
        const questionnaireCells =
          (await readQuestionnaireCellInventory(doc.fileKey as string)) ?? undefined;
        return {
          documentId: doc.documentId as string,
          title,
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells,
          fileKey: doc.fileKey as string,
        };
      }

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
        title,
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
    name: 'get_questionnaire_cells',
    description:
      'Get the filled-in cells of an XLSX QUESTIONNAIRE (targetKind XLSX_QUESTIONNAIRE), addressed ' +
      'by its documentId. Returns non-empty cells with their sheet name, 0-based row/col, A1 ref, ' +
      'and value. Use this to read a questionnaire\'s answers. To point a finding at a specific cell, ' +
      'use an anchor { "kind": "cell", "sheet": "<sheet name>", "row": <row>, "col": <col> } with the ' +
      'EXACT row/col returned here. Large questionnaires are capped; pass valueFilter to narrow.',
    input_schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The XLSX questionnaire documentId from list_package_documents.' },
        valueFilter: {
          type: 'string',
          description:
            'Optional case-insensitive substring; only cells whose value contains it are returned.',
        },
      },
      required: ['documentId'],
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
  {
    name: 'verify_company_facts',
    description:
      'Verify a claim the package makes about the company against the org\'s INTERNAL sources of ' +
      'truth: company profile (identity, NAICS, certifications), approved knowledge base, certification ' +
      'records, usable past-performance records, and the latest approved SOLUTION PLAN (the ' +
      'authoritative approach, team, prices, and services). Call this BEFORE asserting whether a claim ' +
      'about the company (identity fields, certifications, past-performance values, etc.) or a solution ' +
      'detail (a price, team, approach, or service) is accurate. Returns a snapshot of the relevant ' +
      'profile facts, gated KB answers, cert records, NDA-safe past-performance facts, and solution-plan ' +
      'facts. Never returns a withheld client name.',
    input_schema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'The company claim to verify (e.g. "we are ISO 27001 certified").' },
        sources: {
          type: 'array',
          description:
            'Optional subset of sources to consult: "profile", "kb", "certs", "past_performance", ' +
            '"solution_plan". Defaults to all of them.',
          items: { type: 'string', enum: ['profile', 'kb', 'certs', 'past_performance', 'solution_plan'] },
        },
      },
      required: ['claim'],
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
  /** Present for the full/chat review; enables project-scoped KB verification. */
  projectId?: string;
  inventory: PackageInventory;
}) => {
  const { orgId, oppId, projectId, inventory } = ctx;

  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string,
  ): Promise<ToolResult> => {
    try {
      switch (toolName) {
        case 'list_package_documents': {
          const docLines = inventory.documents.map((d) => {
            if (d.targetKind === 'XLSX_QUESTIONNAIRE') {
              const cellCount = d.questionnaireCells?.cells.length ?? 0;
              return (
                `- documentId=${d.documentId} | "${d.title}" | XLSX QUESTIONNAIRE | ` +
                `${cellCount} filled cell(s) — read with get_questionnaire_cells`
              );
            }
            return `- documentId=${d.documentId} | "${d.title}" | headings: ${d.headings.length ? d.headings.map((h) => `"${h}"`).join(', ') : '(none)'}`;
          });
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
          const html = await loadInventoryDocHtml(inventory, doc.htmlContentKey);
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

        case 'get_questionnaire_cells': {
          const documentId = String(toolInput.documentId ?? '');
          const doc = inventory.documents.find((d) => d.documentId === documentId);
          if (!doc || doc.targetKind !== 'XLSX_QUESTIONNAIRE') {
            return { tool_use_id: toolUseId, content: `No XLSX questionnaire with id ${documentId}.` };
          }
          const inv = doc.questionnaireCells;
          if (!inv) {
            return {
              tool_use_id: toolUseId,
              content: `Questionnaire "${doc.title}" could not be read (file missing or unreadable).`,
            };
          }

          const rawFilter = typeof toolInput.valueFilter === 'string' ? toolInput.valueFilter.trim() : '';
          const filter = rawFilter.toLowerCase();
          const matched = filter
            ? inv.cells.filter((c) => c.value.toLowerCase().includes(filter))
            : inv.cells;

          const shown = matched.slice(0, MAX_QUESTIONNAIRE_CELLS_RETURNED);
          const lines = shown.map(
            (c) => `- sheet="${inv.sheetName}" row=${c.row} col=${c.col} (${c.ref}) | value: ${c.value}`,
          );

          const header = filter
            ? `Questionnaire "${doc.title}" [sheet "${inv.sheetName}"] cells matching "${rawFilter}" (${matched.length} of ${inv.cells.length}):`
            : `Questionnaire "${doc.title}" [sheet "${inv.sheetName}"] filled cells (${inv.cells.length}):`;
          const omitted = matched.length - shown.length;
          const footerParts: string[] = [];
          if (omitted > 0) {
            footerParts.push(`… ${omitted} more cell(s) not shown — narrow with valueFilter to see specific cells.`);
          }
          if (inv.truncated) {
            footerParts.push('(The questionnaire is large; some cells beyond the scan window are not included.)');
          }
          const footer = footerParts.length ? `\n${footerParts.join('\n')}` : '';

          return {
            tool_use_id: toolUseId,
            content: `${header}\n${lines.join('\n') || '(no matching cells)'}${footer}`,
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

        case 'verify_company_facts': {
          const claim = String(toolInput.claim ?? '').trim();
          if (!claim) return { tool_use_id: toolUseId, content: 'Provide a claim to verify.' };
          const requested = Array.isArray(toolInput.sources)
            ? new Set(toolInput.sources.map((s) => String(s)))
            : new Set(['profile', 'kb', 'certs', 'past_performance', 'solution_plan']);
          const wants = (s: string) => requested.size === 0 || requested.has(s);

          // Scope KB search to the project's linked KBs when we have a projectId.
          const kbIds = projectId ? await getLinkedKBIds(projectId).catch(() => []) : [];
          const scopedKbIds = kbIds.length > 0 ? kbIds : undefined;

          const [profile, kbHits, certs, ppFacts, planFacts] = await Promise.all([
            wants('profile') ? loadCompanyFacts(orgId) : Promise.resolve(null),
            wants('kb') ? searchKnowledgeBase(orgId, claim, FACTUAL_KB_TOP_K, scopedKbIds) : Promise.resolve([]),
            wants('certs') ? loadCertRecords(orgId, claim) : Promise.resolve([]),
            wants('past_performance') ? searchPastPerformanceUsable(orgId, claim, FACTUAL_PP_TOP_K) : Promise.resolve([]),
            // Solution plan needs a projectId (with oppId) to address the single plan record.
            wants('solution_plan') && projectId
              ? loadSolutionPlanFacts(orgId, projectId, oppId)
              : Promise.resolve(null),
          ]);

          const parts: string[] = [`CLAIM: ${claim}`];

          if (wants('profile')) {
            parts.push(
              profile
                ? 'COMPANY PROFILE:\n' +
                    [
                      `- name: ${profile.dba || profile.legalEntityName || profile.companyName || '(none)'}`,
                      `- UEI: ${profile.uei ?? '(none)'} | CAGE: ${profile.cage ?? '(none)'} | EIN: ${profile.ein ?? '(none)'}`,
                      `- address: ${[profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(', ') || '(none)'}`,
                      `- primary NAICS: ${profile.primaryNaics ?? '(none)'} | entity type: ${profile.entityType ?? '(none)'}`,
                      `- authorized signatory: ${profile.authorizedSignatory?.name ?? '(none)'}`,
                    ].join('\n')
                : 'COMPANY PROFILE: (no profile on record)',
            );
          }
          if (wants('certs')) {
            parts.push(
              'CERTIFICATION RECORDS:\n' +
                (certs.length
                  ? certs
                      .map(
                        (c) =>
                          `- ${c.label} (source: ${c.source}, verified: ${c.verified}, expires: ${c.expiresAt ?? 'n/a'})`,
                      )
                      .join('\n')
                  : '(none on record)'),
            );
          }
          if (wants('kb')) {
            parts.push(
              'KNOWLEDGE BASE (approved, active):\n' +
                (kbHits.length
                  ? kbHits.map((h) => `- Q: ${h.question}\n  A: ${truncateText(h.answer, EXCERPT_MAX_CHARS)}`).join('\n')
                  : '(no approved KB answers matched)'),
            );
          }
          if (wants('past_performance')) {
            parts.push(
              'PAST PERFORMANCE (usable, NDA-safe):\n' +
                (ppFacts.length
                  ? ppFacts
                      .map(
                        (p) =>
                          `- ${p.title} — client: ${p.client} | value: ${p.value ?? 'n/a'} | contract: ${p.contractNumber ?? 'n/a'}`,
                      )
                      .join('\n')
                  : '(no usable past-performance records matched)'),
            );
          }
          if (wants('solution_plan')) {
            parts.push(
              planFacts
                ? 'SOLUTION PLAN (latest approved — authoritative approach/team/prices/services' +
                    `${planFacts.isStale ? ', currently STALE' : ''}):\n` +
                    (planFacts.costItems.length
                      ? 'Cost schedule:\n' +
                        planFacts.costItems
                          .map(
                            (c) =>
                              `- ${c.label}: ${planFacts.currency} ${c.amount} (${c.billing})${c.optional ? ' [optional]' : ''}`,
                          )
                          .join('\n') +
                        '\n'
                      : '') +
                    `Plan text:\n${truncateText(planFacts.text, 1500)}`
                : 'SOLUTION PLAN: (no approved solution plan on record)',
            );
          }

          return { tool_use_id: toolUseId, content: parts.join('\n\n') };
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
