import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getItem, updateItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { getApiKey } from '@/helpers/api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '@/constants/google';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import type { DBItem } from '@/helpers/db';
import { loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { sanitizeFileName } from '@/helpers/export';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/** Map document types to Google Drive folder names (win-optimized proposal order) */
const DOCUMENT_TYPE_FOLDERS: Record<string, string> = {
  // Core proposal sections
  COVER_LETTER: 'Cover Letters',
  EXECUTIVE_SUMMARY: 'Executive Summaries',
  UNDERSTANDING_OF_REQUIREMENTS: 'Understanding of Requirements',
  TECHNICAL_PROPOSAL: 'Technical Proposals',
  PROJECT_PLAN: 'Project Plans',
  TEAM_QUALIFICATIONS: 'Team Qualifications',
  PAST_PERFORMANCE: 'Past Performance',
  COST_PROPOSAL: 'Cost Proposals',
  MANAGEMENT_APPROACH: 'Management Approach',
  RISK_MANAGEMENT: 'Risk Management',
  COMPLIANCE_MATRIX: 'Compliance Matrices',
  CERTIFICATIONS: 'Certifications',
  APPENDICES: 'Appendices',
  // Supporting / administrative
  EXECUTIVE_BRIEF: 'Executive Briefs',
  MANAGEMENT_PROPOSAL: 'Management Proposals',
  PRICE_VOLUME: 'Price Volume',
  QUALITY_MANAGEMENT: 'Quality Management Plans',
  TEAMING_AGREEMENT: 'Teaming Agreements',
  NDA: 'NDAs',
  CONTRACT: 'Contracts',
  AMENDMENT: 'Amendments',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other Documents',
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

const SyncRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

interface RFPDocumentDBItem extends DBItem {
  documentId: string;
  name?: string;
  title?: string;
  documentType?: string;
  mimeType?: string;
  fileKey?: string;
  /** S3 key for the HTML content of AI-generated documents */
  htmlContentKey?: string;
  content?: Record<string, unknown>;
  deletedAt?: string | null;
  originalFileName?: string;
  orgId?: string;
}

// ─── Auth — Domain-Wide Delegation ───
// Service Accounts have no storage quota on personal Drive.
// We MUST use domain-wide delegation (JWT with subject) to impersonate
// a real Google Workspace user who has Drive storage.

async function getDriveClientWithDelegation(orgId: string): Promise<drive_v3.Drive | null> {
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    console.log(`[GoogleDrive] No service account key configured for org ${orgId}`);
    return null;
  }

  let credentials: {
    client_email?: string;
    private_key?: string;
    client_id?: string;
    delegate_email?: string;
  };

  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    console.error('[GoogleDrive] Service account JSON is not valid JSON');
    return null;
  }

  if (!credentials.client_email || !credentials.private_key) {
    console.error(
      '[GoogleDrive] Invalid service account key: missing client_email or private_key. ' +
      'A full Google Service Account JSON key is required.',
    );
    return null;
  }

  const delegateEmail = credentials.delegate_email;
  if (!delegateEmail) {
    console.error(
      '[GoogleDrive] No delegate_email in service account JSON. ' +
      'Service Accounts have no Drive storage quota — domain-wide delegation is required. ' +
      'Add "delegate_email": "user@yourdomain.com" to the service account JSON in org settings. ' +
      'Then configure domain-wide delegation in admin.google.com: ' +
      'Security → API controls → Manage Domain Wide Delegation → ' +
      `Add Client ID ${credentials.client_id ?? '(unknown)'} with scope https://www.googleapis.com/auth/drive`,
    );
    return null;
  }

  try {
    const jwtClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: delegateEmail, // impersonate a real user with Drive storage
    });

    await jwtClient.authorize();
    console.log(`[GoogleDrive] Authorized with domain-wide delegation as ${delegateEmail}`);
    return google.drive({ version: 'v3', auth: jwtClient });
  } catch (err) {
    console.error(
      `[GoogleDrive] JWT authorization failed for delegate ${delegateEmail}: ${(err as Error)?.message}. ` +
      'Ensure domain-wide delegation is configured in admin.google.com.',
    );
    return null;
  }
}

// ─── HTML → DOCX (using docx library, full recursive parser) ─────────────────

type DocxChild = Paragraph | Table;

/** Decode common HTML entities */
const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');

/** Fetch an S3 object and return its bytes as a Buffer.
 *  Returns null for SVG files — docx ImageRun requires a PNG fallback for SVG
 *  which we don't have, so we skip them to avoid runtime errors.
 */
const fetchS3Image = async (key: string): Promise<{ data: Buffer; ext: string } | null> => {
  try {
    const ext = key.split('.').pop()?.toLowerCase() ?? 'png';
    // Skip SVG — docx requires a PNG fallback for SVG images
    if (ext === 'svg') {
      console.warn(`[buildDocxFromHtml] Skipping SVG image (not supported in DOCX without fallback): ${key}`);
      return null;
    }
    const res = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return { data: Buffer.concat(chunks), ext };
  } catch (err) {
    console.warn(`[buildDocxFromHtml] Failed to fetch S3 image: ${key}`, err);
    return null;
  }
};

/** Map file extension to docx ImageRun type (SVG not supported without fallback — treat as png) */
const extToImageType = (ext: string): 'png' | 'jpg' | 'gif' | 'bmp' => {
  const map: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
    png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', bmp: 'bmp',
    // svg intentionally omitted — docx requires a fallback PNG for SVG which we don't have
  };
  return map[ext] ?? 'png';
};

/**
 * Extract inline TextRun children from an HTML snippet.
 * Handles <strong>, <b>, <em>, <i>, <u>, <s>, <del>, <br>.
 */
const parseInlineHtml = (html: string): TextRun[] => {
  const runs: TextRun[] = [];
  // Tokenise into text nodes and inline tags
  const tokenRe = /<(\/?)(\w+)[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let bold = false, italic = false, underline = false, strike = false;

  while ((m = tokenRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2]?.toLowerCase();
    const text = m[3];

    if (text !== undefined) {
      const decoded = decodeEntities(text);
      if (decoded) {
        runs.push(new TextRun({
          text: decoded,
          bold: bold || undefined,
          italics: italic || undefined,
          underline: underline ? {} : undefined,
          strike: strike || undefined,
        }));
      }
    } else if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
    } else if (tag === 'strong' || tag === 'b') {
      bold = !closing;
    } else if (tag === 'em' || tag === 'i') {
      italic = !closing;
    } else if (tag === 'u') {
      underline = !closing;
    } else if (tag === 's' || tag === 'del' || tag === 'strike') {
      strike = !closing;
    }
  }
  return runs;
};

/**
 * Parse a table HTML string into a docx Table.
 * Handles <thead>, <tbody>, <tr>, <th>, <td> — including images inside cells.
 */
const parseTable = async (tableHtml: string): Promise<Table | null> => {
  const rows: TableRow[] = [];
  let maxCols = 1;

  // Extract all <tr> blocks
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const trInner = trMatch[1] ?? '';
    const cells: TableCell[] = [];
    let rowCols = 0;

    // Extract <th> and <td> cells
    const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(trInner)) !== null) {
      rowCols++;
      const isHeader = cellMatch[1]?.toLowerCase() === 'th';
      const cellInner = cellMatch[2] ?? '';

      // Check if cell contains an image
      const imgMatch = /<img[^>]*>/i.exec(cellInner);
      let cellChildren: Paragraph[];

      if (imgMatch) {
        // Extract data-s3-key or src="s3key:KEY"
        const imgTag = imgMatch[0];
        const s3KeyAttr = /data-s3-key="([^"]+)"/.exec(imgTag)?.[1];
        const srcAttr = /src="([^"]+)"/.exec(imgTag)?.[1];
        const s3Key = s3KeyAttr ?? (srcAttr?.startsWith('s3key:') ? srcAttr.slice(6) : null);

        if (s3Key) {
          const imgData = await fetchS3Image(s3Key);
          if (imgData) {
            const type = extToImageType(imgData.ext);
            cellChildren = [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imgData.data,
                    transformation: { width: 100, height: 100 },
                    type,
                  }),
                ],
                spacing: { after: 0 },
              }),
            ];
          } else {
            cellChildren = [new Paragraph({ children: [new TextRun('')], spacing: { after: 0 } })];
          }
        } else {
          cellChildren = [new Paragraph({ children: [new TextRun('')], spacing: { after: 0 } })];
        }
      } else {
        // Plain text / inline content
        const plainText = decodeEntities(cellInner.replace(/<[^>]+>/g, '')).trim();
        cellChildren = [
          new Paragraph({
            children: plainText
              ? [new TextRun({ text: plainText, bold: isHeader || undefined })]
              : [new TextRun('')],
            spacing: { after: 0 },
          }),
        ];
      }

      cells.push(
        new TableCell({
          children: cellChildren,
          shading: isHeader ? { fill: 'F3F4F6' } : undefined,
        }),
      );
    }

    if (cells.length > 0) {
      maxCols = Math.max(maxCols, rowCols);
      rows.push(new TableRow({ children: cells }));
    }
  }

  if (!rows.length) return null;

  // 9360 DXA = 6.5 inches (letter page width minus 1-inch margins each side)
  return new Table({
    rows,
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: Array(maxCols).fill(Math.floor(9360 / maxCols)),
  });
};

/**
 * Parse a standalone <img> tag into a Paragraph containing an ImageRun.
 */
const parseImg = async (imgTag: string): Promise<Paragraph | null> => {
  const s3KeyAttr = /data-s3-key="([^"]+)"/.exec(imgTag)?.[1];
  const srcAttr = /src="([^"]+)"/.exec(imgTag)?.[1];
  const s3Key = s3KeyAttr ?? (srcAttr?.startsWith('s3key:') ? srcAttr.slice(6) : null);

  if (!s3Key) return null;

  const imgData = await fetchS3Image(s3Key);
  if (!imgData) return null;

  const type = extToImageType(imgData.ext);
  return new Paragraph({
    children: [
      new ImageRun({
        data: imgData.data,
        transformation: { width: 400, height: 300 },
        type,
      }),
    ],
    spacing: { after: 200 },
  });
};

/**
 * Convert raw HTML (from the TipTap editor) into a DOCX Buffer using the `docx` library.
 * Handles: headings, paragraphs, lists, blockquotes, tables (with images), standalone images.
 * S3 images referenced via data-s3-key or src="s3key:KEY" are fetched and embedded.
 * The output contains only the HTML content — no extra title/date/customer headers.
 */
const buildDocxFromHtml = async (html: string): Promise<Buffer> => {
  const children: DocxChild[] = [];

  // Tokenise the HTML into top-level blocks.
  // We match: tables, standalone imgs, and block-level tags (h1-h6, p, ul, ol, li, blockquote, hr, div).
  const blockRe =
    /(<table[\s\S]*?<\/table>)|(<img[^>]*\/?>)|(<(h[1-6]|p|ul|ol|li|blockquote|hr|div)[^>]*>([\s\S]*?)<\/\4>)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(html)) !== null) {
    lastIndex = blockRe.lastIndex;

    const tableHtml = match[1];
    const imgTag = match[2];
    const blockTag = match[4]?.toLowerCase();
    const blockInner = match[5] ?? '';

    if (tableHtml) {
      // ── Table ──
      const table = await parseTable(tableHtml);
      if (table) children.push(table);
      continue;
    }

    if (imgTag) {
      // ── Standalone image ──
      const imgPara = await parseImg(imgTag);
      if (imgPara) children.push(imgPara);
      continue;
    }

    if (!blockTag) continue;

    // ── Headings ──
    const headingMap: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
      h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4,
      h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
    };
    if (headingMap[blockTag]) {
      const text = decodeEntities(blockInner.replace(/<[^>]+>/g, '')).trim();
      if (text) children.push(new Paragraph({ text, heading: headingMap[blockTag], spacing: { before: 300, after: 150 } }));
      continue;
    }

    // ── Paragraph ──
    if (blockTag === 'p') {
      // Check for image inside paragraph
      const imgInPara = /<img[^>]*>/.exec(blockInner);
      if (imgInPara) {
        const imgPara = await parseImg(imgInPara[0]);
        if (imgPara) children.push(imgPara);
      } else {
        const runs = parseInlineHtml(blockInner);
        if (runs.length) {
          children.push(new Paragraph({ children: runs, spacing: { after: 200 }, alignment: AlignmentType.JUSTIFIED }));
        }
      }
      continue;
    }

    // ── Unordered list ──
    if (blockTag === 'ul') {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(blockInner)) !== null) {
        const text = decodeEntities((li[1] ?? '').replace(/<[^>]+>/g, '')).trim();
        if (text) children.push(new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 100 } }));
      }
      continue;
    }

    // ── Ordered list ──
    if (blockTag === 'ol') {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(blockInner)) !== null) {
        const text = decodeEntities((li[1] ?? '').replace(/<[^>]+>/g, '')).trim();
        if (text) children.push(new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 100 } }));
      }
      continue;
    }

    // ── Blockquote ──
    if (blockTag === 'blockquote') {
      const text = decodeEntities(blockInner.replace(/<[^>]+>/g, '')).trim();
      if (text) {
        children.push(new Paragraph({
          children: [new TextRun({ text, italics: true })],
          indent: { left: 720 },
          spacing: { after: 200 },
        }));
      }
      continue;
    }

    // ── HR ──
    if (blockTag === 'hr') {
      children.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 200 } }));
      continue;
    }

    // ── Div / other block — extract text ──
    const text = decodeEntities(blockInner.replace(/<[^>]+>/g, '')).trim();
    if (text) children.push(new Paragraph({ text, spacing: { after: 200 } }));
  }

  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun('')] }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
};

// ─── Folder Management ───

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const query = [
    `name='${escapedName}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : undefined,
  ].filter(Boolean).join(' and ');

  const existing = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  if (existing.data.files?.length) {
    return existing.data.files[0]!.id!;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });

  return created.data.id!;
}

// ─── Handler ───

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const { success, data, error } = SyncRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!success) {
      return apiResponse(400, { error: 'Invalid request', details: error.flatten() });
    }

    const { projectId, opportunityId, documentId } = data;
    const sk = `${projectId}#${opportunityId}#${documentId}`;

    // 1. Get the document from DB
    const doc = await getItem<RFPDocumentDBItem>(RFP_DOCUMENT_PK, sk);
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { error: 'Document not found' });
    }

    // 2. Get Drive client using domain-wide delegation
    //    (Service Accounts have no storage quota — must impersonate a real user)
    const drive = await getDriveClientWithDelegation(orgId);
    if (!drive) {
      return apiResponse(400, {
        error: 'Google Drive not configured for this organization.',
        details:
          'Service Accounts require domain-wide delegation to upload files. ' +
          'Add "delegate_email": "user@yourdomain.com" to the service account JSON in org settings, ' +
          'then configure domain-wide delegation in admin.google.com.',
      });
    }

    // 3. Create folder structure: RFP Documents / <projectId> / <Document Type Folder>
    const typeFolderName = DOCUMENT_TYPE_FOLDERS[doc.documentType ?? 'OTHER'] ?? DOCUMENT_TYPE_FOLDERS.OTHER!;
    const rootFolderId = await findOrCreateFolder(drive, 'RFP Documents');
    const projectFolderId = await findOrCreateFolder(drive, projectId, rootFolderId);
    const typeFolderId = await findOrCreateFolder(drive, typeFolderName, projectFolderId);

    let googleDriveFileId: string;
    let googleDriveUrl: string;

    if (doc.htmlContentKey) {
      // 4a. AI-generated document — always regenerate DOCX from latest HTML.
      //     htmlContentKey takes priority over fileKey so re-sync always reflects
      //     the latest editor content, not a stale cached DOCX.
      console.log(`[GoogleDrive] Converting HTML to DOCX for document ${documentId}`);

      const rawHtml = await loadRFPDocumentHtml(doc.htmlContentKey);
      if (!rawHtml) {
        return apiResponse(400, { error: 'Document HTML content is empty' });
      }

      const docTitle = doc.title || (doc.content?.title as string | undefined) || doc.name || documentId;

      const docxBuffer = await buildDocxFromHtml(rawHtml);

      // Store the generated DOCX in S3 so it can be downloaded later
      const sanitized = sanitizeFileName(docTitle);
      const docxS3Key = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/exports/${sanitized}.docx`;
      await s3.send(
        new PutObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: docxS3Key,
          Body: docxBuffer,
          ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      console.log(`[GoogleDrive] DOCX stored at s3://${DOCUMENTS_BUCKET}/${docxS3Key}`);

      // Upload the DOCX to Google Drive
      const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const uploadResult = await drive.files.create({
        requestBody: {
          name: `${sanitized}.docx`,
          parents: [typeFolderId],
          mimeType: docxMimeType,
        },
        media: {
          mimeType: docxMimeType,
          body: Readable.from(docxBuffer),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;

      // Also persist the DOCX S3 key as fileKey so the document can be downloaded
      await updateItem(
        RFP_DOCUMENT_PK,
        sk,
        { fileKey: docxS3Key, mimeType: docxMimeType },
        {},
      );
    } else if (doc.fileKey) {
      // 4b. Pure uploaded file (no HTML content) — stream directly from S3 to Google Drive
      const s3Result = await s3.send(
        new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: doc.fileKey }),
      );

      const chunks: Buffer[] = [];
      for await (const chunk of s3Result.Body as Readable) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const uploadResult = await drive.files.create({
        requestBody: {
          name: doc.name || doc.originalFileName || documentId,
          parents: [typeFolderId],
          mimeType: doc.mimeType || 'application/octet-stream',
        },
        media: {
          mimeType: doc.mimeType || 'application/octet-stream',
          body: Readable.from(buffer),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else if (doc.content) {
      // 4c. Legacy structured content — upload as JSON (fallback)
      const contentStr = JSON.stringify(doc.content, null, 2);
      const fileName = `${doc.name || documentId}.json`;

      const uploadResult = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [typeFolderId],
          mimeType: 'application/json',
        },
        media: {
          mimeType: 'application/json',
          body: Readable.from(Buffer.from(contentStr, 'utf-8')),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else {
      return apiResponse(400, { error: 'Document has no file, HTML content, or structured content to sync' });
    }

    // 5. Update DB record with Google Drive metadata
    await updateItem(
      RFP_DOCUMENT_PK,
      sk,
      { googleDriveFileId, googleDriveUrl },
      { condition: 'attribute_exists(#pk) AND attribute_exists(#sk)' },
    );

    
    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown',
    });

    return apiResponse(200, {
      message: 'Document synced to Google Drive',
      googleDriveFileId,
      googleDriveUrl,
    });
  } catch (error) {
    console.error('Error syncing RFP document to Google Drive:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to sync document to Google Drive';
    return apiResponse(500, { error: message });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
