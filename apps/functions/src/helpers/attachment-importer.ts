/**
 * attachment-importer.ts
 *
 * Shared attachment import logic for:
 * - import-solicitation.ts (SAM.gov, DIBBS, HigherGov imports)
 * - detect-and-import-attachments.ts (linked attachment auto-import from extracted text)
 */
import https from 'https';
import {
  httpsGetBuffer,
  buildAttachmentFilename,
  buildAttachmentS3Key,
  guessContentType,
} from '@/helpers/search-opportunity';
import { uploadToS3 } from '@/helpers/s3';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import { requireEnv } from '@/helpers/env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Attachment {
  url: string;
  name?: string;
  mimeType?: string;
}

export interface ImportAttachmentsArgs {
  orgId: string;
  projectId: string;
  id: string;  // noticeId or oppKey for S3 key generation
  attachments: Attachment[];
  oppId: string;
  sourceDocumentId?: string;  // ID of parent doc (for linked attachments)
  depth?: number;
  httpsAgent?: https.Agent;
  parentFileName?: string;  // Display name of parent document (for UI tooltip)
}

export interface ImportedFile {
  questionFileId: string;
  fileKey: string;
  executionArn?: string;
}

// ─── Content-Type to Extension Mapping ────────────────────────────────────────

/** Map common MIME types to file extensions */
const contentTypeToExt = (ct: string): string | null => {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
    'text/html': '.html',
    'text/csv': '.csv',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/tiff': '.tiff',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
  };
  const base = ct.split(';')[0]?.trim().toLowerCase() ?? '';
  return map[base] ?? null;
};

// ─── Main Import Function ─────────────────────────────────────────────────────

/**
 * Import a single attachment - download, store in S3, create QuestionFile, start pipeline
 */
const importSingleAttachment = async (
  a: Attachment,
  args: ImportAttachmentsArgs,
  httpsAgent: https.Agent,
): Promise<ImportedFile | null> => {
  try {
    const { buf, contentType, filename: headerFilename } = await httpsGetBuffer(
      new URL(a.url),
      { httpsAgent },
    );

    // Priority order for filename:
    // 1. Content-Disposition header (from server response) - most reliable
    // 2. URL extraction (Jaggaer base64, path segment with extension)
    // 3. Attachment name from caller (may be 'attachment.pdf' fallback)
    
    let filename: string;
    if (headerFilename && headerFilename.includes('.')) {
      // Server provided filename via Content-Disposition - highest priority (Google Drive, etc.)
      filename = headerFilename;
    } else {
      // Fall back to URL-based extraction
      filename = buildAttachmentFilename(a, headerFilename);
      const urlFilename = extractFilenameFromUrl(a.url);
      
      // Only use URL filename if it's not a generic fallback like 'attachment.pdf'
      const isGenericFallback = urlFilename === 'attachment.pdf' || urlFilename === 'attachment';
      if (urlFilename.includes('.') && !isGenericFallback && !filename.includes('.')) {
        filename = urlFilename;
      }
      // Use a.name only if it has extension and isn't the generic fallback
      if (a.name && a.name.includes('.') && a.name !== 'attachment.pdf') {
        filename = a.name;
      }
    }

    // Determine content type - trust filename extension first for procurement portals
    let ct = a.mimeType || contentType;
    const filenameExt = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
    
    // If filename has extension, use that to determine MIME type (more reliable for procurement portals)
    if (filenameExt) {
      const extToMime: Record<string, string> = {
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'txt': 'text/plain',
        'csv': 'text/csv',
      };
      if (extToMime[filenameExt]) {
        ct = extToMime[filenameExt];
      }
    }
    
    // Fallback to guessing from filename
    ct = ct || guessContentType(filename);

    // Add extension if missing
    if (filename && !filename.includes('.') && ct) {
      const extFromCt = contentTypeToExt(ct);
      if (extFromCt) filename = `${filename}${extFromCt}`;
    }

    const fileKey = buildAttachmentS3Key({
      orgId: args.orgId,
      projectId: args.projectId,
      noticeId: args.id,
      attachmentUrl: a.url,
      filename,
    });

    await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct ?? 'application/octet-stream');

    const qf = await createQuestionFile({
      orgId: args.orgId,
      oppId: args.oppId,
      projectId: args.projectId,
      fileKey,
      originalFileName: filename,
      mimeType: ct ?? 'application/octet-stream',
      sourceDocumentId: args.sourceDocumentId,
      depth: args.depth ?? 0,
      parentFileName: args.parentFileName,
    });

    const { executionArn } = await startPipeline(
      args.projectId,
      args.oppId,
      qf.questionFileId,
      qf.fileKey,
      qf.mimeType ?? undefined,
    );

    return { questionFileId: qf.questionFileId, fileKey, executionArn };
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[importAttachments] Failed to import ${a.url}:`, message);
    return null;
  }
};

/**
 * Shared attachment import logic - reused by:
 * - import-solicitation.ts (SAM.gov, DIBBS, HigherGov imports)
 * - detect-and-import-attachments.ts (linked attachment auto-import)
 *
 * All attachments are imported in parallel (non-blocking).
 */
export const importAttachments = async (args: ImportAttachmentsArgs): Promise<ImportedFile[]> => {
  const httpsAgent = args.httpsAgent ?? new https.Agent({ keepAlive: true });

  // Import all attachments in parallel
  const results = await Promise.allSettled(
    args.attachments.map(a => importSingleAttachment(a, args, httpsAgent)),
  );

  // Collect successful imports
  const files: ImportedFile[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      files.push(result.value);
    }
  }

  return files;
};

// ─── Link Detection ───────────────────────────────────────────────────────────

// MIME types we can process
// NOTE: Only file types supported by the question pipeline (Textract for PDF/images, DOCX parser, Excel parser)
// Excluding text/plain and text/csv - these fail with UnsupportedFileType in the pipeline
const PROCESSABLE_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // Often used for downloads - we'll check extension too
  'application/binary', // Non-standard but equivalent to octet-stream (used by Google Drive)
]);

// URLs to skip (navigation, auth, tracking, images, etc.)
const SKIP_URL_PATTERNS = [
  /logout/i,
  /login/i,
  /signin/i,
  /register/i,
  /password/i,
  /account/i,
  /mailto:/i,
  /javascript:/i,
  /#$/,
  /\.(html?|php|aspx?|jsp|png|jpg|jpeg|gif|svg|ico|css|js)(\?|$)/i,
];

export interface DetectedLink {
  url: string;
  filename: string;
}

/**
 * Detect ALL https URLs in text (broad pattern)
 */
export const detectAttachmentLinks = (text: string): DetectedLink[] => {
  const seen = new Set<string>();
  const results: DetectedLink[] = [];

  // Match any HTTPS URL
  const urlPattern = /https?:\/\/[^\s"'<>\)\]\}]+/gi;
  const matches = text.matchAll(urlPattern);

  for (const match of matches) {
    let rawUrl = match[0].trim().replace(/[.,;:!?\)\]\}]+$/, ''); // Clean trailing punctuation
    
    if (seen.has(rawUrl.toLowerCase())) continue;
    seen.add(rawUrl.toLowerCase());

    // Skip navigation/auth/images/etc
    if (SKIP_URL_PATTERNS.some(p => p.test(rawUrl))) continue;

    const filename = extractFilenameFromUrl(rawUrl);
    results.push({ url: rawUrl, filename });
  }

  console.log(`[detectAttachmentLinks] Found ${results.length} candidate URLs`);
  return results;
};

// Extensions the question pipeline cannot process (skip even if Content-Type is generic)
const UNSUPPORTED_EXTENSIONS = new Set([
  '.txt', '.csv', '.log', '.json', '.xml',
  '.html', '.htm', '.php', '.asp', '.aspx', '.jsp',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.bmp', '.webp',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
]);

/**
 * Check if a URL serves a processable document via HEAD request.
 */
export const isProcessableDocument = async (url: string, agent: https.Agent): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD',
        agent,
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RFPBot/1.0)' },
      }, (res) => {
        const ct = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
        const disp = res.headers['content-disposition'] ?? '';
        
        // HTML pages - skip
        if (ct.includes('text/html') || ct.includes('xhtml')) {
          resolve(false);
          return;
        }
        
        // For generic types (octet-stream/binary), check filename extension
        if (ct === 'application/octet-stream' || ct === 'application/binary') {
          // Try to get filename from Content-Disposition or URL
          const dispMatch = disp.match(/filename[*]?=["']?([^"';\n]+)/i);
          const filename = dispMatch?.[1] || extractFilenameFromUrl(url);
          const ext = filename.match(/(\.[^.]+)$/)?.[1]?.toLowerCase();
          
          if (ext && UNSUPPORTED_EXTENSIONS.has(ext)) {
            console.log(`[isProcessableDocument] ${url} → ${ct} → skipped (unsupported extension: ${ext})`);
            resolve(false);
            return;
          }
        }
        
        // Check Content-Type or Content-Disposition attachment
        const isProcessable = PROCESSABLE_CONTENT_TYPES.has(ct) || disp.includes('attachment');
        console.log(`[isProcessableDocument] ${url} → ${ct} → ${isProcessable}`);
        resolve(isProcessable);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
};

/**
 * Filter detected links via HEAD requests (concurrency-limited).
 */
export const filterDocumentLinks = async (
  links: DetectedLink[],
  agent: https.Agent,
): Promise<DetectedLink[]> => {
  const results: DetectedLink[] = [];
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < links.length; i += BATCH_SIZE) {
    const batch = links.slice(i, i + BATCH_SIZE);
    const checks = await Promise.all(
      batch.map(async link => ({ link, ok: await isProcessableDocument(link.url, agent) })),
    );
    results.push(...checks.filter(c => c.ok).map(c => c.link));
  }
  
  console.log(`[filterDocumentLinks] ${results.length}/${links.length} are processable documents`);
  return results;
};

/**
 * Extract filename from URL.
 * Handles special cases:
 * - Jaggaer: filename encoded as base64 in ?file= query param
 * - Standard: filename from last path segment
 */
export const extractFilenameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    
    // Special case: Jaggaer URLs have base64-encoded filename in ?file= param
    // Example: /PublicEventDownload?file=U291cmNpbmd...3BkZg== → decodes to Sourcingevent/.../filename.pdf
    if (parsed.hostname.includes('jaggaer.com') && parsed.searchParams.has('file')) {
      try {
        const b64 = parsed.searchParams.get('file')!;
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        // Format is typically: Sourcingevent/123-456filename.pdf
        // Extract just the filename (last path segment)
        const parts = decoded.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1] || decoded;
        // Remove any leading ID patterns like "1383465-20064763" at the start
        const cleaned = lastPart.replace(/^\d+-\d+/, '').trim();
        if (cleaned) return cleaned;
      } catch {
        // If base64 decode fails, fall through to path extraction
      }
    }
    
    // Standard: use last path segment
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = pathParts[pathParts.length - 1];
    if (lastSegment && lastSegment.includes('.')) {
      return decodeURIComponent(lastSegment);
    }
    
    // Fallback: default with .pdf extension
    return 'attachment.pdf';
  } catch {
    const match = url.match(/([^\/\?]+\.(?:pdf|docx?|xlsx?|csv|txt))(?:\?|$)/i);
    return match?.[1] || 'attachment.pdf';
  }
};
