import { queryBySkPrefix } from '@/helpers/db';
import { updateRFPDocumentMetadata, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import { getTemplate, listTemplatesByOrg } from '@/helpers/template';
import { MAX_SOLICITATION_CHARS } from '@/constants/document-generation';
import { QUESTION_PK } from '@/constants/question';
import type { RFPDocumentContent, TemplateSection } from '@auto-rfp/core';
import type { BedrockResponse, QaPair } from '@/types/document-generation';

export type { QaPair };

// ─── Template HTML builder ────────────────────────────────────────────────────

/**
 * Converts template sections to an HTML scaffold that the AI model fills in.
 * Each section becomes an <h2> with its description as a comment, and
 * placeholder content markers so the model knows what to replace.
 */
export const buildTemplateHtmlScaffold = (sections: TemplateSection[]): string => {
  if (!sections.length) return '';

  const parts: string[] = [
    `<!-- TEMPLATE SCAFFOLD: Fill in all [CONTENT] placeholders with real content -->`,
  ];

  for (const section of sections.sort((a, b) => a.order - b.order)) {
    parts.push(
      `<h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em">${section.title}</h2>`,
    );

    if (section.description) {
      parts.push(
        `<!-- Section guidance: ${section.description} -->`,
      );
    }

    // If the section has pre-authored content (e.g. boilerplate), include it
    if (section.content?.trim()) {
      parts.push(section.content.trim());
    } else {
      parts.push(
        `<p style="margin:0 0 1em;line-height:1.7;color:#374151">[CONTENT: Write 3-5 paragraphs for "${section.title}" based on the solicitation and Q&A context]</p>`,
      );
    }

    // Sections no longer have subsections — content is stored directly in section.content
  }

  return parts.join('\n');
};

// ─── Bedrock response parsing ───

export const extractBedrockText = (outer: BedrockResponse): string => {
  const text = outer.content?.[0]?.text?.trim();
  if (text) return text;
  if (outer.output_text?.trim()) return outer.output_text.trim();
  if (outer.completion?.trim()) return outer.completion.trim();
  return '';
};

// ─── Q&A pairs ───

export async function loadQaPairs(projectId: string): Promise<QaPair[]> {
  const items = await queryBySkPrefix<QaPair & { question?: string; answer?: string }>(
    QUESTION_PK,
    `${projectId}#`,
  );
  return items.map(({ question = '', answer = '' }) => ({ question, answer }));
}

// ─── Solicitation text ───

export async function loadSolicitation(projectId: string, opportunityId: string): Promise<string> {
  try {
    return await loadAllSolicitationTexts(projectId, opportunityId, MAX_SOLICITATION_CHARS);
  } catch (err) {
    console.warn('Failed to load solicitation texts:', (err as Error)?.message);
    return '';
  }
}

// ─── Template sections ───

export async function resolveTemplateSections(
  orgId: string,
  documentType: string,
  templateId?: string,
): Promise<unknown[] | null> {
  if (templateId) {
    const t = await getTemplate(orgId, templateId);
    return t?.sections ?? null;
  }
  try {
    const { items } = await listTemplatesByOrg(orgId, {
      category: documentType,
      status: 'PUBLISHED',
      limit: 1,
    });
    return items?.[0]?.sections ?? null;
  } catch {
    return null;
  }
}

// ─── Document status update ───
// When status is COMPLETE and content is provided:
//   1. Upload the HTML body to S3 and store only the key in DynamoDB (htmlContentKey).
//   2. Store metadata (title, customerName, outlineSummary, opportunityId) in DynamoDB content field
//      WITHOUT the large `content` (html) string — that lives in S3.

export async function updateDocumentStatus(
  projectId: string,
  opportunityId: string,
  documentId: string,
  status: 'COMPLETE' | 'FAILED',
  content?: RFPDocumentContent,
  generationError?: string,
  orgId?: string,
): Promise<void> {
  let htmlContentKey: string | undefined;

  // Upload HTML to S3 when we have content and an orgId to build the key
  if (status === 'COMPLETE' && content?.content && orgId) {
    try {
      htmlContentKey = await uploadRFPDocumentHtml({
        orgId,
        projectId,
        opportunityId,
        documentId,
        html: content.content,
      });
      console.log(`HTML content uploaded to S3: ${htmlContentKey}`);
    } catch (err) {
      console.error('Failed to upload HTML to S3, falling back to DynamoDB storage:', err);
      // Fall back: keep content in DynamoDB if S3 upload fails
    }
  }

  // Build the content object stored in DynamoDB — metadata only, no HTML (HTML lives in S3)
  const dbContent = content
    ? {
        title: content.title,
        customerName: content.customerName,
        opportunityId: content.opportunityId,
        outlineSummary: content.outlineSummary,
      }
    : undefined;

  await updateRFPDocumentMetadata({
    projectId,
    opportunityId,
    documentId,
    updates: {
      status,
      ...(dbContent && {
        content: dbContent,
        title: content!.title || 'Generated Document',
        name: content!.title || 'Generated Document',
      }),
      ...(htmlContentKey && { htmlContentKey }),
      ...(generationError && { generationError }),
    },
    updatedBy: 'system',
  });
}
