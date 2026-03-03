import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mammoth from 'mammoth';
import { withSentryLambda } from '@/sentry-lambda';
import {
  getRFPDocument,
  updateRFPDocumentMetadata,
  uploadRFPDocumentHtml,
} from '@/helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const s3Client = new S3Client({ region: REGION });

// ─── HTML helpers ─────────────────────────────────────────────────────────────

/**
 * Convert plain text to simple HTML paragraphs.
 * Each double-newline-separated block becomes a <p> tag.
 */
const textToHtml = (text: string): string => {
  if (!text?.trim()) return '<p></p>';
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const escaped = para
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 1em;line-height:1.7;color:#374151">${escaped}</p>`;
    })
    .join('\n');
};

/**
 * Wrap raw mammoth HTML output in a styled document shell.
 * Mammoth produces clean semantic HTML — we just add consistent styling.
 */
const wrapMammothHtml = (html: string, title: string): string => {
  // Add inline styles to mammoth's output elements
  const styled = html
    .replace(/<h1>/g, '<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">')
    .replace(/<h2>/g, '<h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em">')
    .replace(/<h3>/g, '<h3 style="font-size:1.1em;font-weight:600;margin:1.2em 0 0.4em;color:#374151">')
    .replace(/<p>/g, '<p style="margin:0 0 1em;line-height:1.7;color:#374151">')
    .replace(/<ul>/g, '<ul style="margin:0 0 1em;padding-left:1.5em">')
    .replace(/<ol>/g, '<ol style="margin:0 0 1em;padding-left:1.5em">')
    .replace(/<li>/g, '<li style="margin-bottom:0.4em;line-height:1.6;color:#374151">')
    .replace(/<table>/g, '<table style="width:100%;border-collapse:collapse;margin:1em 0">')
    .replace(/<th>/g, '<th style="padding:0.6em 0.8em;text-align:left;font-weight:600;font-size:0.9em;background:#4f46e5;color:#fff">')
    .replace(/<td>/g, '<td style="padding:0.6em 0.8em;font-size:0.9em;color:#374151;border-bottom:1px solid #e2e8f0">');

  return [
    `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${title}</h1>`,
    styled,
  ].join('\n');
};

// ─── Metadata extraction ──────────────────────────────────────────────────────

/**
 * Extract a plain-text title from the first heading or first line of HTML.
 */
const extractTitleFromHtml = (html: string, fallback: string): string => {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].replace(/<[^>]*>/g, '').trim() || fallback;
  }
  return fallback;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

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

    // Load document record
    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
    if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

    // Already converted — return existing htmlContentKey or inline content
    if (doc.htmlContentKey || doc.content) {
      return apiResponse(200, {
        ok: true,
        htmlContentKey: doc.htmlContentKey ?? null,
        content: doc.content ?? null,
        alreadyConverted: true,
      });
    }

    // Must have a file to convert
    if (!doc.fileKey) {
      return apiResponse(400, { message: 'Document has no file to convert' });
    }

    const mimeType = (doc.mimeType as string) || '';
    const fileKey = doc.fileKey as string;
    const isDocx = mimeType.includes('wordprocessingml') || mimeType.includes('msword') || fileKey.endsWith('.docx');
    const isPdf = mimeType.includes('application/pdf') || fileKey.endsWith('.pdf');
    const isText = mimeType.includes('text/plain') || mimeType.includes('text/markdown') || fileKey.endsWith('.txt') || fileKey.endsWith('.md');

    if (!isDocx && !isPdf && !isText) {
      return apiResponse(400, {
        message: `Cannot convert ${mimeType} files. Supported: docx, pdf, txt, md.`,
      });
    }

    // Download file from S3
    const getCmd = new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: fileKey });
    const s3Response = await s3Client.send(getCmd);
    if (!s3Response.Body) return apiResponse(500, { message: 'Failed to download file from S3' });

    const docTitle = (doc.name as string) || (doc.title as string) || 'Untitled Document';
    let html = '';

    if (isDocx) {
      const buffer = Buffer.from(await s3Response.Body.transformToByteArray());
      const result = await mammoth.convertToHtml({ buffer });
      if (result.messages.length > 0) {
        console.warn('Mammoth conversion warnings:', result.messages);
      }
      html = wrapMammothHtml(result.value, extractTitleFromHtml(result.value, docTitle));
    } else if (isPdf) {
      const buffer = Buffer.from(await s3Response.Body.transformToByteArray());
      let pdfText = '';
      try {
        const pdfParseModule = require('pdf-parse/lib/pdf-parse');
        const pdfResult = await pdfParseModule(buffer);
        pdfText = pdfResult.text;
      } catch (pdfErr) {
        console.warn('pdf-parse failed, falling back to basic text extraction:', pdfErr);
        const rawText = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
        const textMatches = rawText.match(/\(([^)]+)\)/g) ?? [];
        pdfText = textMatches
          .map((m: string) => m.slice(1, -1))
          .filter((t: string) => t.length > 1 && /[a-zA-Z]/.test(t))
          .join(' ');
        if (!pdfText) {
          pdfText = 'PDF content could not be extracted. Please convert this PDF to DOCX or TXT format for editing.';
        }
      }
      html = [
        `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${docTitle}</h1>`,
        textToHtml(pdfText),
      ].join('\n');
    } else {
      // Plain text / markdown
      const text = await s3Response.Body.transformToString('utf-8');
      html = [
        `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${docTitle}</h1>`,
        textToHtml(text),
      ].join('\n');
    }

    // ── Upload HTML to S3 — store only the key in DynamoDB ──
    const htmlContentKey = await uploadRFPDocumentHtml({
      orgId,
      projectId,
      opportunityId,
      documentId,
      html,
    });

    // Metadata stored in DynamoDB (no HTML inline)
    const contentMeta = {
      title: docTitle,
      customerName: null,
      opportunityId,
      outlineSummary: null,
    };

    const editHistory = ((doc.editHistory as Record<string, unknown>[] | undefined) ?? []);
    editHistory.push({
      editedBy: userId,
      editedAt: new Date().toISOString(),
      action: 'CONVERT',
      changeNote: `Converted from ${isDocx ? 'DOCX' : isPdf ? 'PDF' : 'text'} to HTML`,
      version: (doc.version as number) || 1,
    });

    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        content: contentMeta,
        htmlContentKey,
        title: docTitle,
        editHistory,
      },
      updatedBy: userId,
    });

    return apiResponse(200, {
      ok: true,
      htmlContentKey,
      content: contentMeta,
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
