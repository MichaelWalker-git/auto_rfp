/**
 * Parse template HTML to extract section structure for AI generation.
 *
 * This helper extracts headings (<h2>, <h3>) from template HTML to create
 * a section outline that can be used for section-by-section document generation.
 * It also preserves the original HTML content between headings so the AI can
 * maintain template boilerplate, images, and resolved macro values.
 *
 * Enhanced to support:
 * - Robust section boundary detection (h2-based splitting)
 * - Section-level template content preservation (images, boilerplate, macros)
 * - Content placeholder detection for simple templates
 */

import type { DocumentSection } from './document-section-generator';

// ─── Text Extraction Helpers ──────────────────────────────────────────────────

/**
 * Strip HTML tags, unresolved macros, and placeholder text from a string.
 * Returns clean text suitable for use as a section title or description.
 */
const cleanHeadingText = (raw: string): string =>
  raw
    .replace(/<[^>]+>/g, '')           // Remove HTML tags
    .replace(/\{\{[A-Z0-9_]+\}\}/g, '') // Remove unresolved {{MACRO}} placeholders
    .replace(/\[[^\]]+\]/g, '')         // Remove [placeholder] text
    .replace(/&nbsp;/g, ' ')           // Replace &nbsp; with space
    .replace(/&amp;/g, '&')           // Decode &amp;
    .replace(/\s+/g, ' ')             // Collapse whitespace
    .trim();

/**
 * Extract all <h3> headings from a block of HTML content.
 * Returns them as a concatenated description string.
 */
const extractH3Descriptions = (html: string): string | undefined => {
  const h3Matches = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  if (!h3Matches.length) return undefined;

  const descriptions = h3Matches
    .map(m => cleanHeadingText(m[1] ?? ''))
    .filter(Boolean);

  return descriptions.length > 0 ? descriptions.join('. ') : undefined;
};

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse template HTML to extract sections based on <h2> heading structure.
 *
 * Strategy:
 * 1. Find all <h2> positions in the template
 * 2. Split the template at each <h2> boundary
 * 3. For each section:
 *    - Extract the <h2> text as the section title
 *    - Extract any <h3> headings as description/guidance
 *    - Preserve the full HTML content between this <h2> and the next as `templateContent`
 * 4. Content before the first <h2> is the preamble (not a section)
 * 5. Content after the last section may include a postamble
 *
 * Returns null if no <h2> sections found (simple wrapper template).
 *
 * @param templateHtml - Raw HTML template with {{MACRO}} placeholders resolved
 * @returns Array of sections or null if no structured sections found
 */
export const parseTemplateSections = (templateHtml: string): DocumentSection[] | null => {
  if (!templateHtml?.trim()) return null;

  // Find all <h2> tag positions
  const h2Positions: Array<{ index: number; fullMatch: string; innerHtml: string }> = [];
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let match: RegExpExecArray | null;

  while ((match = h2Regex.exec(templateHtml)) !== null) {
    h2Positions.push({
      index: match.index,
      fullMatch: match[0],
      innerHtml: match[1] ?? '',
    });
  }

  if (h2Positions.length === 0) {
    // No <h2> headings found — this is a simple wrapper template
    return null;
  }

  const sections: DocumentSection[] = [];

  for (let i = 0; i < h2Positions.length; i++) {
    const current = h2Positions[i]!;
    const next = h2Positions[i + 1];

    // Extract section title from <h2> content
    const title = cleanHeadingText(current.innerHtml);
    if (!title) continue; // Skip empty headings

    // Determine the content boundary for this section:
    // From end of <h2> tag to start of next <h2> tag (or end of document)
    const sectionContentStart = current.index + current.fullMatch.length;
    const sectionContentEnd = next ? next.index : templateHtml.length;
    const sectionContent = templateHtml.substring(sectionContentStart, sectionContentEnd).trim();

    // Extract <h3> headings from section content as description
    const description = extractH3Descriptions(sectionContent);

    // Build the section object
    const section: DocumentSection = {
      title,
      ...(description && { description }),
      // Preserve the full section content (between h2 boundaries) including
      // boilerplate, images, resolved macros, and placeholder markers
      ...(sectionContent && { templateContent: sectionContent }),
    };

    sections.push(section);
  }

  return sections.length > 0 ? sections : null;
};

/**
 * Determine if a template has meaningful structure (sections) or is just a wrapper.
 *
 * A template has structure if it contains <h2> headings.
 * A template is a simple wrapper if it only contains {{CONTENT}} placeholders.
 *
 * @param templateHtml - Raw HTML template
 * @returns true if template has structured sections (h2 headings)
 */
export const templateHasStructure = (templateHtml: string): boolean => {
  if (!templateHtml?.trim()) return false;
  return /<h2[^>]*>/i.test(templateHtml);
};

// ─── Template Content Injection ───────────────────────────────────────────────

/**
 * Inject AI-generated section HTML fragments into a single document.
 *
 * Simply joins the generated section fragments with double newlines.
 * Each fragment is a complete HTML snippet starting with an <h2> heading.
 *
 * @param _templateHtml - Unused (kept for API compatibility)
 * @param sectionHtmlFragments - Array of generated HTML fragments, each starting with <h2>
 * @returns Complete document HTML from joined section fragments
 */
export const injectSectionsIntoTemplate = (
  _templateHtml: string,
  sectionHtmlFragments: string[],
): string => {
  return sectionHtmlFragments.join('\n\n');
};

/**
 * Inject AI-generated content into a simple (non-sectioned) template.
 *
 * The template MUST contain a `{{CONTENT}}` variable (resolved to `[CONTENT: ...]`
 * after macro processing). The generated content replaces ONLY that placeholder.
 * No content is added outside the designated placeholder area.
 *
 * Also handles `<p>` tags wrapping the placeholder — the entire `<p>` is replaced
 * so the generated HTML (which may contain block elements) isn't nested inside a `<p>`.
 *
 * Returns `null` if no content placeholder is found in the template, indicating
 * the template is missing the required `{{CONTENT}}` variable.
 *
 * @param templateHtml - The preprocessed template HTML (macros resolved)
 * @param generatedHtml - The AI-generated HTML content
 * @returns Complete document HTML with content injected, or null if no placeholder found
 */
export const injectContentIntoSimpleTemplate = (
  templateHtml: string,
  generatedHtml: string,
): string | null => {
  if (!templateHtml?.trim()) return generatedHtml;
  if (!generatedHtml?.trim()) return templateHtml;

  // Try to find and replace a <p> tag wrapping a [CONTENT: ...] placeholder first.
  // This avoids nesting block-level generated HTML inside a <p> tag.
  // IMPORTANT: Only replace the FIRST occurrence to avoid duplicating content
  if (/<p[^>]*>\s*\[CONTENT:\s*[^\]]*\]\s*<\/p>/i.test(templateHtml)) {
    return templateHtml.replace(/<p[^>]*>\s*\[CONTENT:\s*[^\]]*\]\s*<\/p>/i, generatedHtml);
  }

  // Try to find and replace a bare [CONTENT: ...] placeholder
  // IMPORTANT: Only replace the FIRST occurrence to avoid duplicating content
  if (/\[CONTENT:\s*[^\]]*\]/i.test(templateHtml)) {
    return templateHtml.replace(/\[CONTENT:\s*[^\]]*\]/i, generatedHtml);
  }

  // No content placeholder found — template is missing the required {{CONTENT}} variable
  return null;
};
