/**
 * detect-and-import-attachments.ts
 *
 * Step Function Lambda that scans extracted text for attachment URLs and auto-imports them.
 * This runs after text extraction and before question extraction in the pipeline.
 *
 * Key features:
 * - Detects attachment links in extracted text using regex patterns
 * - Supports Jaggaer, SAM.gov, DIBBS, PlanetBids, BidNet, and direct file URLs
 * - Downloads and imports ALL detected attachments (no limit)
 * - Recursive crawling up to MAX_LINK_DEPTH (original→child→grandchild→great-grandchild)
 * - Each imported child starts its own pipeline, enabling natural recursive crawling
 */
import https from 'https';
import { requireEnv } from '@/helpers/env';
import { loadTextFromS3, getFileFromS3 } from '@/helpers/s3';
import { getQuestionFileItem } from '@/helpers/questionFile';
import {
  detectAttachmentLinks,
  filterDocumentLinks,
  importAttachments,
  extractFilenameFromUrl,
  type DetectedLink,
} from '@/helpers/attachment-importer';
import { extractPdfHyperlinks } from '@/helpers/pdf-hyperlinks';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { MAX_LINK_DEPTH } from '@/constants/attachment';
import { v4 as uuidv4 } from 'uuid';

/**
 * Convert S3 stream to Buffer with proper error handling.
 * @param stream - Node.js readable stream from S3
 * @returns Buffer containing the stream data
 * @throws Error if stream emits an error event
 */
const streamToBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── Input/Output Types ───────────────────────────────────────────────────────

interface DetectAttachmentsInput {
  questionFileId: string;
  projectId: string;
  oppId: string;
  textFileKey?: string;
  orgId?: string;
}

interface DetectAttachmentsOutput {
  parentQuestionFileId: string;
  detectedLinks: number;
  importedAttachments: number;
  errors: string[];
  childQuestionFileIds: string[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (input: DetectAttachmentsInput): Promise<DetectAttachmentsOutput> => {
  const { questionFileId, projectId, oppId } = input;

  const output: DetectAttachmentsOutput = {
    parentQuestionFileId: questionFileId,
    detectedLinks: 0,
    importedAttachments: 0,
    errors: [],
    childQuestionFileIds: [],
  };

  // 1. Get parent question file to check depth
  const parentFile = await getQuestionFileItem(projectId, oppId, questionFileId);
  if (!parentFile) {
    output.errors.push('Parent question file not found');
    return output;
  }

  // HI-5: Access depth/textFileKey directly - they're already in the QuestionFileItem type
  const parentDepth = parentFile.depth ?? 0;
  if (parentDepth >= MAX_LINK_DEPTH) {
    return output;
  }

  // 2. Load extracted text - parentFile.textFileKey is optional in schema
  const resolvedTextFileKey = input.textFileKey ?? parentFile.textFileKey ?? undefined;
  if (!resolvedTextFileKey) {
    output.errors.push('No text file key available');
    return output;
  }

  let extractedText: string;
  try {
    extractedText = await loadTextFromS3(DOCUMENTS_BUCKET, resolvedTextFileKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.errors.push(`Failed to load text: ${message}`);
    return output;
  }

  if (!extractedText || extractedText.trim().length === 0) {
    return output;
  }

  // 3. Detect URLs from extracted text
  const textLinks: DetectedLink[] = detectAttachmentLinks(extractedText);

  // 4. Extract hyperlinks from original PDF file (Textract only gets visible text, not hyperlinks)
  let pdfLinks: DetectedLink[] = [];
  const fileKey = parentFile.fileKey;
  const isPdf = fileKey?.toLowerCase().endsWith('.pdf') || parentFile.mimeType?.includes('pdf');
  
  if (isPdf && fileKey) {
    try {
      const stream = await getFileFromS3(DOCUMENTS_BUCKET, fileKey);
      const pdfBuffer = await streamToBuffer(stream as NodeJS.ReadableStream);
      const hyperlinks = extractPdfHyperlinks(pdfBuffer);
      
      // Convert to DetectedLink format
      pdfLinks = hyperlinks.map(url => ({
        url,
        filename: extractFilenameFromUrl(url),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[detect-attachments] Failed to extract PDF hyperlinks: ${message}`);
    }
  }

  // 5. Merge and dedupe URLs from text + PDF hyperlinks
  const seen = new Set<string>();
  const candidateLinks: DetectedLink[] = [];
  
  for (const link of [...textLinks, ...pdfLinks]) {
    const normalized = link.url.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidateLinks.push(link);
    }
  }

  if (candidateLinks.length === 0) {
    return output;
  }

  // 6. Filter to only processable documents (HEAD request to check Content-Type)
  const links = await filterDocumentLinks(candidateLinks, httpsAgent);
  output.detectedLinks = links.length;

  if (links.length === 0) {
    return output;
  }

  // 7. Import ALL processable documents (no limit)
  const attachments = links.map(link => ({
    url: link.url,
    name: link.filename,
  }));

  const orgId = input.orgId ?? parentFile.orgId;
  if (!orgId) {
    output.errors.push('orgId not available');
    return output;
  }

  // Get parent file name for display in UI tooltip on child documents
  const parentFileName = parentFile.originalFileName ?? parentFile.fileKey?.split('/').pop() ?? 'Unknown document';

  try {
    const imported = await importAttachments({
      orgId,
      projectId,
      id: oppId,  // Use oppId as the "noticeId" for S3 key generation
      attachments,
      oppId,
      sourceDocumentId: questionFileId,  // Link to parent
      depth: parentDepth + 1,  // Increment depth from parent (0→1→2→3)
      httpsAgent,
      parentFileName,  // Display name for UI tooltip
    });

    output.importedAttachments = imported.length;
    output.childQuestionFileIds = imported.map(f => f.questionFileId);

    // HI-2: Write audit log for successful attachment imports (non-blocking for background pipeline)
    if (imported.length > 0) {
      const hmacSecret = await getHmacSecret();
      writeAuditLog({
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: 'ATTACHMENTS_AUTO_IMPORTED',
        resource: 'question_file',
        resourceId: questionFileId,
        changes: {
          after: {
            parentDocumentId: questionFileId,
            childDocuments: imported.map(f => f.questionFileId),
            count: imported.length,
            depth: parentDepth + 1,
          },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: 'success',
      }, hmacSecret).catch(err =>
        console.warn('Failed to write audit log (non-blocking):', err instanceof Error ? err.message : String(err)),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.errors.push(`Import failed: ${message}`);
  }

  return output;
};
