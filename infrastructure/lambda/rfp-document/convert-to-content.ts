import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mammoth from 'mammoth';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument, updateRFPDocumentMetadata } from '../helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { requireEnv } from '../helpers/env';
import { v4 as uuidv4 } from 'uuid';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const s3Client = new S3Client({ region: REGION });

/**
 * Parse HTML output from mammoth into a structured ProposalDocument.
 * Uses regex to extract complete HTML elements (headings and paragraphs),
 * then maps them into sections and subsections.
 */
function htmlToProposalDocument(html: string, title: string): Record<string, any> {
  // Extract all block-level elements as an ordered list of { type, level, text }
  interface Block {
    type: 'heading' | 'paragraph';
    level: number; // 1-6 for headings, 0 for paragraphs
    text: string;
  }

  const blocks: Block[] = [];

  // Match headings: <h1>...</h1> through <h6>...</h6>
  // Match paragraphs: <p>...</p>
  // Match list items: <li>...</li>
  const blockRegex = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[2];
    const text = stripHtml(innerHtml).trim();

    if (!text) continue;

    if (tag.startsWith('h')) {
      const level = parseInt(tag[1], 10);
      blocks.push({ type: 'heading', level, text });
    } else {
      blocks.push({ type: 'paragraph', level: 0, text });
    }
  }

  // If no blocks extracted (e.g., plain text without tags), fall back to full text
  if (blocks.length === 0) {
    const plainText = stripHtml(html).trim();
    if (plainText) {
      blocks.push({ type: 'paragraph', level: 0, text: plainText });
    }
  }

  // Now build sections/subsections from the blocks
  const sections: any[] = [];
  let currentSection: any = null;
  let currentSubsection: any = null;
  let contentBuffer: string[] = [];

  function flushContent() {
    if (contentBuffer.length === 0) return;
    const text = contentBuffer.join('\n\n');
    contentBuffer = [];

    if (currentSubsection) {
      currentSubsection.content = currentSubsection.content
        ? `${currentSubsection.content}\n\n${text}`
        : text;
    } else if (currentSection) {
      // Create a default subsection for the content
      currentSubsection = {
        id: uuidv4(),
        title: 'Content',
        content: text,
      };
      currentSection.subsections.push(currentSubsection);
    } else {
      // No section yet — create a default one
      currentSection = {
        id: uuidv4(),
        title: 'Document Content',
        summary: null,
        subsections: [],
      };
      currentSubsection = {
        id: uuidv4(),
        title: 'Content',
        content: text,
      };
      currentSection.subsections.push(currentSubsection);
      sections.push(currentSection);
    }
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      // Flush any accumulated content before starting a new section/subsection
      flushContent();

      if (block.level <= 2) {
        // H1/H2 → new section
        currentSubsection = null;
        currentSection = {
          id: uuidv4(),
          title: block.text,
          summary: null,
          subsections: [],
        };
        sections.push(currentSection);
      } else {
        // H3+ → new subsection within current section
        if (!currentSection) {
          currentSection = {
            id: uuidv4(),
            title: 'Document Content',
            summary: null,
            subsections: [],
          };
          sections.push(currentSection);
        }
        currentSubsection = {
          id: uuidv4(),
          title: block.text,
          content: '',
        };
        currentSection.subsections.push(currentSubsection);
      }
    } else {
      // Paragraph or list item → accumulate as content
      contentBuffer.push(block.text);
    }
  }

  // Flush remaining content
  flushContent();

  // If no sections were created, create a default one
  if (sections.length === 0) {
    const plainText = stripHtml(html).trim();
    sections.push({
      id: uuidv4(),
      title: 'Document Content',
      summary: null,
      subsections: [{
        id: uuidv4(),
        title: 'Content',
        content: plainText || '',
      }],
    });
  }

  // Ensure all sections have at least one subsection
  for (const section of sections) {
    if (section.subsections.length === 0) {
      section.subsections.push({
        id: uuidv4(),
        title: 'Content',
        content: '',
      });
    }
  }

  return {
    proposalTitle: title,
    customerName: null,
    opportunityId: null,
    outlineSummary: null,
    sections,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Convert plain text to ProposalDocument structure.
 */
function textToProposalDocument(text: string, title: string): Record<string, any> {
  const paragraphs = text.split(/\n{2,}/);
  const sections: any[] = [];
  let currentContent = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Heuristic: lines that are short and don't end with punctuation might be headings
    const isHeading = trimmed.length < 100 && !trimmed.endsWith('.') && !trimmed.endsWith(',');

    if (isHeading && currentContent) {
      // Save previous content as a section
      if (sections.length === 0) {
        sections.push({
          id: uuidv4(),
          title: 'Introduction',
          summary: null,
          subsections: [{ id: uuidv4(), title: 'Content', content: currentContent.trim() }],
        });
      } else {
        const lastSection = sections[sections.length - 1];
        lastSection.subsections.push({ id: uuidv4(), title: 'Content', content: currentContent.trim() });
      }
      currentContent = '';
      sections.push({
        id: uuidv4(),
        title: trimmed,
        summary: null,
        subsections: [],
      });
    } else {
      currentContent += (currentContent ? '\n\n' : '') + trimmed;
    }
  }

  // Flush remaining content
  if (currentContent.trim()) {
    if (sections.length === 0) {
      sections.push({
        id: uuidv4(),
        title: 'Document Content',
        summary: null,
        subsections: [{ id: uuidv4(), title: 'Content', content: currentContent.trim() }],
      });
    } else {
      const lastSection = sections[sections.length - 1];
      lastSection.subsections.push({ id: uuidv4(), title: 'Content', content: currentContent.trim() });
    }
  }

  if (sections.length === 0) {
    sections.push({
      id: uuidv4(),
      title: 'Document Content',
      summary: null,
      subsections: [{ id: uuidv4(), title: 'Content', content: text }],
    });
  }

  return {
    proposalTitle: title,
    customerName: null,
    opportunityId: null,
    outlineSummary: null,
    sections,
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const body = JSON.parse(event.body);
    const { projectId, opportunityId, documentId } = body;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    // Get the document
    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (doc.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    // If already has content, return it
    if (doc.content) {
      return apiResponse(200, { ok: true, content: doc.content, alreadyConverted: true });
    }

    // Must have a file to convert
    if (!doc.fileKey) {
      return apiResponse(400, { message: 'Document has no file to convert' });
    }

    const mimeType = doc.mimeType || '';
    const isDocx = mimeType.includes('wordprocessingml') || mimeType.includes('msword') || doc.fileKey.endsWith('.docx');
    const isPdf = mimeType.includes('application/pdf') || doc.fileKey.endsWith('.pdf');
    const isText = mimeType.includes('text/plain') || mimeType.includes('text/markdown') || doc.fileKey.endsWith('.txt') || doc.fileKey.endsWith('.md');

    if (!isDocx && !isPdf && !isText) {
      return apiResponse(400, {
        message: `Cannot convert ${mimeType} files. Supported: docx, pdf, txt, md.`,
      });
    }

    // Download file from S3
    const getCmd = new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: doc.fileKey });
    const s3Response = await s3Client.send(getCmd);

    if (!s3Response.Body) {
      return apiResponse(500, { message: 'Failed to download file from S3' });
    }

    let content: Record<string, any>;
    const docTitle = doc.name || doc.title || 'Untitled Document';

    if (isDocx) {
      const buffer = Buffer.from(await s3Response.Body.transformToByteArray());
      const result = await mammoth.convertToHtml({ buffer });
      content = htmlToProposalDocument(result.value, docTitle);

      if (result.messages.length > 0) {
        console.warn('Mammoth conversion warnings:', result.messages);
      }
    } else if (isPdf) {
      const buffer = Buffer.from(await s3Response.Body.transformToByteArray());
      // Extract text from PDF using pdf-parse with test mode disabled
      // pdf-parse requires a workaround for Lambda (no DOM/canvas)
      try {
        const pdfParseModule = require('pdf-parse/lib/pdf-parse');
        const pdfResult = await pdfParseModule(buffer);
        content = textToProposalDocument(pdfResult.text, docTitle);
      } catch (pdfErr) {
        console.warn('pdf-parse failed, falling back to basic text extraction:', pdfErr);
        // Fallback: extract readable text from PDF buffer using regex
        const rawText = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
        const textMatches = rawText.match(/\(([^)]+)\)/g) || [];
        const extractedText = textMatches
          .map(m => m.slice(1, -1))
          .filter(t => t.length > 1 && /[a-zA-Z]/.test(t))
          .join(' ');
        content = textToProposalDocument(
          extractedText || 'PDF content could not be extracted. Please convert this PDF to DOCX or TXT format for editing.',
          docTitle,
        );
      }
    } else {
      // Plain text / markdown
      const text = await s3Response.Body.transformToString('utf-8');
      content = textToProposalDocument(text, docTitle);
    }

    // Save content to the document and add edit history entry
    const editHistory = doc.editHistory || [];
    editHistory.push({
      editedBy: userId,
      editedAt: new Date().toISOString(),
      action: 'CONVERT',
      changeNote: `Converted from ${isDocx ? 'DOCX' : isPdf ? 'PDF' : 'text'} to editable content`,
      version: doc.version || 1,
    });

    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        content,
        title: content.proposalTitle || docTitle,
      },
      updatedBy: userId,
    });

    return apiResponse(200, {
      ok: true,
      content,
      alreadyConverted: false,
    });
  } catch (err) {
    console.error('Error converting document:', err);
    return apiResponse(500, {
      message: 'Failed to convert document',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(middy(baseHandler));