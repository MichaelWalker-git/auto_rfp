/**
 * attachment-importer.ts
 *
 * Shared attachment import logic for:
 * - import-solicitation.ts (SAM.gov, DIBBS, HigherGov imports)
 * - detect-and-import-attachments.ts (linked attachment auto-import from extracted text)
 */
import https from 'https';
import dns from 'dns/promises';
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

// ─── Security: SSRF Protection ────────────────────────────────────────────────

// Max download size: 100MB (protects against DoS via large files)
const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024;

// Private/internal IP ranges to block (SSRF protection)
const BLOCKED_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^10\./,                           // RFC 1918 Class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./,   // RFC 1918 Class B
  /^192\.168\./,                     // RFC 1918 Class C
  /^169\.254\./,                     // Link-local
  /^0\./,                            // "This" network
  /^fc00:/i,                         // IPv6 Unique Local
  /^fe80:/i,                         // IPv6 Link-local
  /^::1$/,                           // IPv6 Loopback
];

// Hostnames to block
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  'metadata.google.internal',       // GCP metadata
  '169.254.169.254',                // AWS/Azure/GCP metadata service
]);

/**
 * Check if an IP address is private/internal (SSRF target)
 */
const isPrivateIp = (ip: string): boolean => {
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(ip)) {
      return true;
    }
  }
  return false;
};

/**
 * Resolve hostname to IPs and check if any resolve to private/internal addresses.
 * Prevents DNS rebinding attacks (e.g., 127.0.0.1.nip.io, attacker-controlled DNS).
 */
const resolveAndCheckDns = async (hostname: string): Promise<{ safe: boolean; reason?: string }> => {
  try {
    // Resolve both IPv4 and IPv6 addresses
    const [ipv4Addresses, ipv6Addresses] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    
    const allAddresses = [...ipv4Addresses, ...ipv6Addresses];
    
    if (allAddresses.length === 0) {
      // DNS resolution failed or returned no results - block to be safe
      return { safe: false, reason: 'DNS resolution failed' };
    }
    
    // Check each resolved IP against blocked patterns
    for (const ip of allAddresses) {
      if (isPrivateIp(ip)) {
        return { safe: false, reason: `resolved to private IP: ${ip}` };
      }
      // Also check for IPv6 loopback
      if (ip === '::1' || ip.toLowerCase() === '0:0:0:0:0:0:0:1') {
        return { safe: false, reason: `resolved to loopback: ${ip}` };
      }
    }
    
    return { safe: true };
  } catch (err) {
    // DNS error - block to be safe
    return { safe: false, reason: `DNS error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

/**
 * Synchronous URL validation (hostname/protocol checks only).
 * Use isSafeUrlAsync for full validation including DNS resolution.
 * 
 * NOTE: Only HTTPS is allowed because httpsGetBuffer() uses https.request().
 */
export const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // Require HTTPS - httpsGetBuffer uses https.request() which is HTTPS-only
    if (parsed.protocol !== 'https:') {
      console.warn(`[SSRF] Blocked non-HTTPS URL: ${url}`);
      return false;
    }
    
    // Block known dangerous hostnames
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      console.warn(`[SSRF] Blocked hostname: ${hostname}`);
      return false;
    }
    
    // Block private IP ranges (if hostname is an IP literal)
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        console.warn(`[SSRF] Blocked private IP: ${hostname}`);
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
};

/**
 * Async URL validation with DNS resolution check.
 * Prevents DNS rebinding attacks (e.g., 127.0.0.1.nip.io).
 */
export const isSafeUrlAsync = async (url: string): Promise<boolean> => {
  // First do synchronous checks
  if (!isSafeUrl(url)) {
    return false;
  }
  
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // Skip DNS check if hostname is already an IP address
    const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.includes(':');
    if (isIpLiteral) {
      return true; // Already checked by isSafeUrl
    }
    
    // Resolve DNS and check for private IPs
    const dnsResult = await resolveAndCheckDns(hostname);
    if (!dnsResult.safe) {
      console.warn(`[SSRF] Blocked URL (DNS check): ${url} - ${dnsResult.reason}`);
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};

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
    // SSRF protection: block internal/private URLs with DNS resolution check
    if (!(await isSafeUrlAsync(a.url))) {
      console.warn(`[importAttachments] Skipped unsafe URL: ${a.url}`);
      return null;
    }

    const { buf, contentType, filename: headerFilename } = await httpsGetBuffer(
      new URL(a.url),
      { httpsAgent, urlValidator: isSafeUrl, maxBytes: MAX_DOWNLOAD_SIZE_BYTES },
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

    // Skip legacy .doc files — mammoth cannot parse them and the pipeline has no converter.
    // Users must save as .docx in Word/Google Docs and upload manually.
    const isLegacyDoc =
      ct === 'application/msword' ||
      (filename.toLowerCase().endsWith('.doc') && !filename.toLowerCase().endsWith('.docx'));
    if (isLegacyDoc) {
      console.warn(
        `[importAttachments] Skipping legacy .doc file (not supported): ${filename} (${a.url})`,
      );
      return null;
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
      args.orgId,
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

// Concurrency and rate limits to prevent Lambda resource exhaustion
const MAX_CONCURRENT_DOWNLOADS = 3;  // Max parallel HTTP downloads
const MAX_ATTACHMENTS_PER_INVOCATION = 20;  // Prevent runaway imports

/**
 * Shared attachment import logic - reused by:
 * - import-solicitation.ts (SAM.gov, DIBBS, HigherGov imports)
 * - detect-and-import-attachments.ts (linked attachment auto-import)
 *
 * Imports attachments with concurrency limiting to prevent resource exhaustion.
 */
export const importAttachments = async (args: ImportAttachmentsArgs): Promise<ImportedFile[]> => {
  const httpsAgent = args.httpsAgent ?? new https.Agent({ keepAlive: true });
  
  // Enforce max attachments limit
  const attachments = args.attachments.slice(0, MAX_ATTACHMENTS_PER_INVOCATION);
  if (args.attachments.length > MAX_ATTACHMENTS_PER_INVOCATION) {
    console.warn(
      `[importAttachments] Truncated ${args.attachments.length} attachments to ${MAX_ATTACHMENTS_PER_INVOCATION}`,
    );
  }

  // Import with concurrency limit (batch processing)
  const files: ImportedFile[] = [];
  for (let i = 0; i < attachments.length; i += MAX_CONCURRENT_DOWNLOADS) {
    const batch = attachments.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
    const results = await Promise.allSettled(
      batch.map(a => importSingleAttachment(a, args, httpsAgent)),
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        files.push(result.value);
      }
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
  '.doc', // legacy binary Word — mammoth cannot parse; users must convert to .docx
  '.txt', '.csv', '.log', '.json', '.xml',
  '.html', '.htm', '.php', '.asp', '.aspx', '.jsp',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.bmp', '.webp',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
]);

/**
 * Check if a URL serves a processable document via HEAD request.
 * Follows redirects (with SSRF validation) and checks content-type at final URL.
 * Also rejects files exceeding MAX_DOWNLOAD_SIZE_BYTES via Content-Length header.
 */
export const isProcessableDocument = async (
  url: string, 
  agent: https.Agent,
  maxRedirects = 5,
): Promise<boolean> => {
  // SSRF protection: validate URL before making HEAD request
  if (!isSafeUrl(url)) {
    console.warn(`[isProcessableDocument] Blocked unsafe URL: ${url}`);
    return false;
  }

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
        const status = res.statusCode ?? 0;
        
        // Handle redirects - follow with SSRF validation
        if ([301, 302, 303, 307, 308].includes(status)) {
          const loc = res.headers.location;
          if (!loc) {
            console.log(`[isProcessableDocument] ${url} → ${status} redirect without location`);
            resolve(false);
            return;
          }
          if (maxRedirects <= 0) {
            console.log(`[isProcessableDocument] ${url} → too many redirects`);
            resolve(false);
            return;
          }
          
          const redirectUrl = new URL(loc, url).toString();
          
          // SSRF check on redirect target
          if (!isSafeUrl(redirectUrl)) {
            console.warn(`[isProcessableDocument] Blocked redirect to unsafe URL: ${redirectUrl}`);
            resolve(false);
            return;
          }
          
          // Recursively check the redirect target
          res.resume();
          isProcessableDocument(redirectUrl, agent, maxRedirects - 1).then(resolve);
          return;
        }
        
        const ct = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
        const disp = res.headers['content-disposition'] ?? '';
        const contentLength = parseInt(res.headers['content-length'] ?? '0', 10);
        
        // Size check: reject files exceeding limit BEFORE downloading
        if (contentLength > MAX_DOWNLOAD_SIZE_BYTES) {
          console.log(`[isProcessableDocument] ${url} → rejected (Content-Length: ${contentLength} exceeds ${MAX_DOWNLOAD_SIZE_BYTES})`);
          resolve(false);
          return;
        }
        
        // Get filename from Content-Disposition or URL (for Jaggaer base64-encoded filenames)
        const dispMatch = disp.match(/filename[*]?=["']?([^"';\n]+)/i);
        const filename = dispMatch?.[1] || extractFilenameFromUrl(url);
        const ext = filename.match(/(\.[^.]+)$/)?.[1]?.toLowerCase();
        
        // HTML pages - skip
        if (ct.includes('text/html') || ct.includes('xhtml')) {
          resolve(false);
          return;
        }
        
        // For generic types (octet-stream/binary), check filename extension
        if (ct === 'application/octet-stream' || ct === 'application/binary') {
          if (ext && UNSUPPORTED_EXTENSIONS.has(ext)) {
            console.log(`[isProcessableDocument] ${url} → ${ct} → skipped (unsupported extension: ${ext})`);
            resolve(false);
            return;
          }
        }
        
        // SPECIAL CASE: Server returns misleading Content-Type (e.g., text/plain) but filename has document extension
        // This happens with Jaggaer and some other procurement portals
        const PROCESSABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.xls', '.xlsx']);
        if (ext && PROCESSABLE_EXTENSIONS.has(ext)) {
          console.log(`[isProcessableDocument] ${url} → ${ct} (but filename: ${filename}) → true (trusted extension)`);
          resolve(true);
          return;
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
