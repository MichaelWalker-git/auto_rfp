/**
 * Constants for attachment link detection and import.
 */

/**
 * Maximum depth for recursive linked attachment crawling.
 * Current behavior supports:
 * - 0 = original user-uploaded document
 * - 1 = child (directly linked from original)
 */
export const MAX_LINK_DEPTH = 1;

/**
 * Maximum PDF size to scan for hyperlinks (50MB).
 * Larger PDFs are skipped to avoid memory exhaustion.
 */
export const MAX_PDF_SIZE_FOR_HYPERLINK_SCAN = 50 * 1024 * 1024;
