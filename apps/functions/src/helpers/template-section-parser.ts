/**
 * Parse template HTML to extract section structure for AI generation.
 *
 * This helper extracts headings (<h2>, <h3>) from template HTML to create
 * a section outline that can be used for section-by-section document generation.
 * It also preserves the original HTML content between headings so the AI can
 * maintain template boilerplate, images, and resolved macro values.
 */

import type { DocumentSection } from './document-section-generator';

/**
 * Parse template HTML to extract sections based on heading structure.
 *
 * Strategy:
 * - Extract all <h2> and <h3> headings from the template
 * - Each <h2> becomes a major section
 * - <h3> following an <h2> becomes guidance/description for that section
 * - Content between headings is preserved as `templateContent` for each section
 * - Ignore <h1> (document title) and headings beyond <h3>
 *
 * Returns null if no sections found (simple wrapper template).
 *
 * @param templateHtml - Raw HTML template with {{MACRO}} placeholders resolved
 * @returns Array of sections or null if no structured sections found
 */
export const parseTemplateSections = (templateHtml: string): DocumentSection[] | null => {
  if (!templateHtml?.trim()) return null;

  // Extract all heading tags with their text content and positions
  // Match: <h2>Title</h2>, <h2 class="...">Title</h2>, <h3>Subtitle</h3>
  const headingMatches = [
    ...templateHtml.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/gi),
  ];

  if (headingMatches.length === 0) {
    // No headings found — this is a simple wrapper template
    return null;
  }

  const sections: DocumentSection[] = [];
  let currentSection: DocumentSection | null = null;
  let currentSectionEndIndex = -1;

  for (const match of headingMatches) {
    const level = match[1]; // '2' or '3'
    const rawText = match[2] ?? '';
    const matchStartIndex = match.index ?? 0;

    // Strip HTML tags and macros from the heading text
    const text = rawText
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/\{\{[A-Z0-9_]+\}\}/g, '') // Remove unresolved macros
      .replace(/\[[^\]]+\]/g, '') // Remove [placeholder] text
      .trim();

    if (!text) continue; // Skip empty headings

    if (level === '2') {
      // Before starting a new section, capture the content of the previous section
      if (currentSection && currentSectionEndIndex >= 0) {
        const contentBetween = templateHtml.substring(currentSectionEndIndex, matchStartIndex).trim();
        if (contentBetween) {
          currentSection.templateContent = contentBetween;
        }
      }

      // H2 = new major section — push previous section
      if (currentSection) {
        sections.push(currentSection);
      }

      // Track where this heading ends (after the closing tag)
      const fullMatchLength = match[0]?.length ?? 0;
      currentSectionEndIndex = matchStartIndex + fullMatchLength;

      currentSection = { title: text };
    } else if (level === '3' && currentSection) {
      // H3 = description/guidance for current section
      if (!currentSection.description) {
        currentSection.description = text;
      } else {
        // Multiple H3s — concatenate
        currentSection.description += `. ${text}`;
      }
      // Update end index to after this h3
      const fullMatchLength = match[0]?.length ?? 0;
      currentSectionEndIndex = matchStartIndex + fullMatchLength;
    }
  }

  // Capture content for the last section (from last heading to end of template)
  if (currentSection && currentSectionEndIndex >= 0) {
    const remainingContent = templateHtml.substring(currentSectionEndIndex).trim();
    if (remainingContent) {
      currentSection.templateContent = remainingContent;
    }
    sections.push(currentSection);
  }

  return sections.length > 0 ? sections : null;
};

/**
 * Determine if a template has meaningful structure (sections) or is just a wrapper.
 *
 * A template has structure if it contains <h2> or <h3> headings.
 * A template is a simple wrapper if it only contains {{CONTENT}} placeholders.
 *
 * @param templateHtml - Raw HTML template
 * @returns true if template has structured sections (h2/h3 headings)
 */
export const templateHasStructure = (templateHtml: string): boolean => {
  if (!templateHtml?.trim()) return false;
  return /<h[23][^>]*>/i.test(templateHtml);
};

// ─── Template Preamble / Postamble Extraction ─────────────────────────────────

/**
 * Extract the "preamble" from a template — everything before the first <h2> tag.
 *
 * This typically includes:
 * - HTML comments (scaffold markers)
 * - Company logo / header images
 * - Document title (<h1>)
 * - Introductory text, dates, solicitation numbers
 * - Any boilerplate before the first major section
 *
 * @param templateHtml - Preprocessed template HTML (macros already resolved)
 * @returns The preamble HTML string, or empty string if no <h2> found
 */
export const extractTemplatePreamble = (templateHtml: string): string => {
  if (!templateHtml?.trim()) return '';

  const firstH2Match = templateHtml.match(/<h2[\s>]/i);
  if (!firstH2Match?.index) return '';

  return templateHtml.substring(0, firstH2Match.index).trim();
};

/**
 * Extract the "postamble" from a template — everything after the last section's content.
 *
 * Strategy:
 * 1. Find all <h2> positions
 * 2. The last section starts at the last <h2>
 * 3. The postamble is content after the last section that doesn't belong to any section
 *
 * In practice, we look for content after the last section's placeholder/content block.
 * If the template ends with section content, the postamble is empty.
 *
 * @param templateHtml - Preprocessed template HTML (macros already resolved)
 * @returns The postamble HTML string, or empty string if none found
 */
export const extractTemplatePostamble = (templateHtml: string): string => {
  if (!templateHtml?.trim()) return '';

  // Find all h2 positions
  const h2Matches = [...templateHtml.matchAll(/<h2[^>]*>.*?<\/h2>/gi)];
  if (h2Matches.length === 0) return '';

  const lastH2 = h2Matches[h2Matches.length - 1]!;
  const lastH2End = (lastH2.index ?? 0) + lastH2[0].length;

  // Look for content after the last section that appears to be a footer/closing
  // We consider the postamble to be any content after the last section that:
  // - Comes after a significant gap (empty lines, <hr>, etc.)
  // - Contains footer-like elements (copyright, contact info, page numbers)
  // - Is NOT a [CONTENT: ...] placeholder or section body text

  const afterLastH2 = templateHtml.substring(lastH2End);

  // Find the next h2 (shouldn't exist since this is the last one, but safety check)
  const nextH2 = afterLastH2.match(/<h2[\s>]/i);
  if (nextH2) return ''; // There's another h2 — no postamble

  // Look for a clear boundary: <hr>, <!-- FOOTER -->, or similar markers
  const footerMarkers = [
    /<!--\s*FOOTER\s*-->/i,
    /<!--\s*END\s+(?:OF\s+)?(?:CONTENT|SECTIONS|DOCUMENT)\s*-->/i,
    /<hr\s*\/?>/i,
    /<footer[\s>]/i,
  ];

  for (const marker of footerMarkers) {
    const match = afterLastH2.match(marker);
    if (match?.index !== undefined) {
      return afterLastH2.substring(match.index).trim();
    }
  }

  // No explicit footer marker found — no postamble
  return '';
};

// ─── Template Content Injection ───────────────────────────────────────────────

/**
 * Inject AI-generated section HTML fragments back into the original template structure.
 *
 * This is the key function that ensures generated documents preserve the template's
 * header, footer, images, boilerplate, and styling while replacing only the section
 * content with AI-generated text.
 *
 * Strategy:
 * 1. Extract the template preamble (header, logo, title, intro before first <h2>)
 * 2. Extract the template postamble (footer, closing after last section)
 * 3. Reconstruct: preamble + generated sections + postamble
 *
 * @param templateHtml - The preprocessed template HTML (macros resolved, images preserved)
 * @param sectionHtmlFragments - Array of generated HTML fragments, each starting with <h2>
 * @returns Complete document HTML with template structure preserved
 */
export const injectSectionsIntoTemplate = (
  templateHtml: string,
  sectionHtmlFragments: string[],
): string => {
  if (!templateHtml?.trim() || !sectionHtmlFragments.length) {
    return sectionHtmlFragments.join('\n\n');
  }

  const preamble = extractTemplatePreamble(templateHtml);
  const postamble = extractTemplatePostamble(templateHtml);

  const parts: string[] = [];

  // Add preamble (header, logo, title, intro)
  if (preamble) {
    parts.push(preamble);
  }

  // Add all generated section fragments
  parts.push(...sectionHtmlFragments);

  // Add postamble (footer, closing)
  if (postamble) {
    parts.push(postamble);
  }

  return parts.join('\n\n');
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
