/**
 * pdf-hyperlinks.ts
 *
 * Extract hyperlink URLs from PDF files.
 * Textract only extracts visible text, not embedded hyperlinks.
 * This helper parses the raw PDF structure to find /URI annotations.
 */

import { MAX_PDF_SIZE_FOR_HYPERLINK_SCAN } from '@/constants/attachment';

/**
 * Extract hyperlink URLs from a PDF buffer.
 * 
 * PDFs store URLs in annotation dictionaries like:
 * - /URI (https://example.com/file.pdf)
 * - /A << /S /URI /URI (https://...) >>
 * - /URI <hexencoded>
 * 
 * @param pdfBuffer - Buffer containing the PDF file data
 * @returns Array of unique URL strings found in the PDF
 * @remarks
 * - Returns empty array for empty, null, or oversized buffers
 * - Maximum buffer size is controlled by MAX_PDF_SIZE_FOR_HYPERLINK_SCAN (50MB)
 * - URLs are deduplicated before returning
 */
export const extractPdfHyperlinks = (pdfBuffer: Buffer): string[] => {
  // Validate buffer before processing
  if (!pdfBuffer || pdfBuffer.length === 0) {
    return [];
  }
  if (pdfBuffer.length > MAX_PDF_SIZE_FOR_HYPERLINK_SCAN) {
    console.warn(`[extractPdfHyperlinks] Skipping: PDF too large (${pdfBuffer.length} bytes, max ${MAX_PDF_SIZE_FOR_HYPERLINK_SCAN})`);
    return [];
  }

  const seen = new Set<string>();
  const results: string[] = [];

  // Convert buffer to string for regex matching
  // Note: PDFs are binary but URL annotations are typically in ASCII regions
  const pdfString = pdfBuffer.toString('latin1');

  // Pattern 1: /URI (https://...) - parenthesis-encoded URLs
  const uriParenPattern = /\/URI\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = uriParenPattern.exec(pdfString)) !== null) {
    const url = decodePdfString(match[1]);
    if (isValidUrl(url) && !seen.has(url)) {
      seen.add(url);
      results.push(url);
    }
  }

  // Pattern 2: /URI <hexstring> - hex-encoded URLs
  const uriHexPattern = /\/URI\s*<([0-9A-Fa-f]+)>/gi;
  while ((match = uriHexPattern.exec(pdfString)) !== null) {
    const url = hexToString(match[1]);
    if (isValidUrl(url) && !seen.has(url)) {
      seen.add(url);
      results.push(url);
    }
  }

  // Pattern 3: Literal URLs that might be in the PDF content (less reliable)
  // This catches URLs that may not be in annotation format
  const literalUrlPattern = /https?:\/\/[^\s<>"'\)\]\\]+/gi;
  while ((match = literalUrlPattern.exec(pdfString)) !== null) {
    let url = match[0];
    // Clean up PDF escape sequences and trailing chars
    url = url.replace(/\\[()]/g, '').replace(/[)>\]]+$/, '');
    if (isValidUrl(url) && !seen.has(url)) {
      seen.add(url);
      results.push(url);
    }
  }

  console.log(`[extractPdfHyperlinks] Found ${results.length} hyperlinks in PDF`);
  return results;
};

/**
 * Decode PDF string escapes.
 * PDFs use backslash escapes: \( \) \\ \n \r \t
 */
const decodePdfString = (str: string): string => {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    // Handle octal escapes like \012
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
};

/**
 * Convert hex string to regular string.
 */
const hexToString = (hex: string): string => {
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    result += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return result;
};

/**
 * Basic URL validation.
 */
const isValidUrl = (str: string): boolean => {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
