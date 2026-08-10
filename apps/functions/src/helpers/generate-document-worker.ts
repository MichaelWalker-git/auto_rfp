/**
 * Helpers for the RFP Document Generation SQS Worker.
 *
 * Contains the generation strategies and utility functions used by the worker handler.
 * Supports two generation strategies:
 *
 * 1. **Template section-by-section** — Parse template into <h2> sections, generate each
 *    independently with AI + tools, then merge back into template structure.
 *
 * 2. **Single-shot** — Generate the entire document in one AI conversation with a
 *    tool-use loop (up to MAX_TOOL_ROUNDS iterations).
 */

import { z } from 'zod';

import { safeParseJsonFromModel } from '@/helpers/json';
import { gatherAllContext } from '@/helpers/document-context';
import {
  buildSystemPromptForDocumentType,
  buildSectionSystemPrompt,
  buildUserPromptForDocumentType,
} from '@/helpers/document-prompts';
import { resolveDocumentPromptFragments } from '@/helpers/document-prompt-overrides';
import {
  extractBedrockText,
  loadQaPairs,
  loadSolicitation,
  resolveTemplateFurniture,
  resolveTemplateHtml,
  validateGeneratedContent,
  type QaPair,
} from '@/helpers/document-generation';
import { getTemplate, findBestTemplate, loadTemplateHtml, replaceMacros, buildMacroValues } from '@/helpers/template';
import { uploadRFPDocumentHtml, updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from '@/helpers/rfp-document-version';
import { v4 as uuidv4 } from 'uuid';
import { getRFPDocument } from '@/helpers/rfp-document';
import { BEDROCK_MODEL_ID, MAX_TOKENS, TEMPERATURE } from '@/constants/document-generation';
import { RFPDocumentContentSchema, RFPDocumentTypeSchema, RFP_DOCUMENT_TYPES, type RFPDocumentContent } from '@auto-rfp/core';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import { invokeModel } from '@/helpers/bedrock-http-client';
import {
  generateDocumentSectionBySectionHtml,
  buildDocumentTitleHtml,
} from '@/helpers/document-section-generator';
import {
  parseTemplateSections,
  injectSectionsIntoTemplate,
  injectContentIntoSimpleTemplate,
} from '@/helpers/template-section-parser';

// ─── Schema & Types ───────────────────────────────────────────────────────────

export const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentType: RFPDocumentTypeSchema,
  templateId: z.string().optional(),
  documentId: z.string().min(1),
  /** Optional export options for CLARIFYING_QUESTIONS document type */
  options: z.record(z.unknown()).optional(),
});

export type Job = z.infer<typeof JobSchema>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Document types that typically produce large table-heavy content */
const TABLE_HEAVY_TYPES = new Set(['COMPLIANCE_MATRIX', 'APPENDICES', 'PAST_PERFORMANCE', 'CERTIFICATIONS']);

/** Maximum tool-use rounds for single-shot generation */
const MAX_TOOL_ROUNDS = 5;

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize the model response: the AI returns `htmlContent` but the schema
 * canonical field is `content`. Merge them so downstream code always uses `content`.
 * Also generates a minimal HTML fallback if neither field has content.
 */
export const ensureHtmlContent = (doc: RFPDocumentContent, templateHtml?: string): RFPDocumentContent => {
  const effectiveContent = doc.content || doc.htmlContent || null;

  if (effectiveContent) {
    return { ...doc, content: effectiveContent, htmlContent: undefined };
  }

  console.warn('Model did not return htmlContent — generating minimal HTML fallback');

  const titleHtml = buildDocumentTitleHtml(doc.title, templateHtml);
  const html = [
    titleHtml,
    doc.outlineSummary
      ? `<p style="margin:0 0 1em;line-height:1.7">${doc.outlineSummary}</p>`
      : '',
  ].filter(Boolean).join('\n');

  return { ...doc, content: html, htmlContent: undefined };
};

/**
 * Build a minimal default template for document types that don't have a custom template.
 * Uses a simple {{CONTENT}} placeholder so the AI generates the full document body.
 */
export const buildDefaultTemplate = (): string =>
  `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, etc.) in their original positions. -->
<p style="margin:0 0 1em;line-height:1.7">[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Include appropriate headings, sections, and structure.]</p>`;

/**
 * Get the human-readable label for a document type.
 * Uses the RFP_DOCUMENT_TYPES map for known types, falls back to title-casing the enum value.
 */
export const getDocumentTypeLabel = (documentType: string): string =>
  RFP_DOCUMENT_TYPES[documentType as keyof typeof RFP_DOCUMENT_TYPES]
  ?? documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Extract a clean document title from template HTML.
 * Falls back to the human-readable document type label from RFP_DOCUMENT_TYPES.
 */
export const extractDocumentTitle = (templateHtml: string, documentType: string): string => {
  const titleMatch = templateHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const rawTitle = titleMatch ? titleMatch[1] : null;

  if (rawTitle) {
    const cleaned = rawTitle
      .replace(/<[^>]+>/g, '')            // Remove HTML tags
      .replace(/\{\{[A-Z0-9_]+\}\}/g, '') // Remove unresolved macros
      .replace(/\[[^\]]+\]/g, '')         // Remove [placeholder] text
      // Decode whitespace entities to real spaces BEFORE trimming — a literal
      // "&nbsp;" is not whitespace, so .trim() alone leaves it stuck to the title
      // (e.g. TipTap emits "<h1>&nbsp;Physical Records…</h1>" and the entity
      // persists into the stored title/name, rendering as literal "&nbsp;" text).
      .replace(/&nbsp;?|&#x0*a0;?|&#0*160;?| /gi, ' ')
      .replace(/\s+/g, ' ')               // Collapse runs of whitespace
      .trim();
    if (cleaned) return cleaned;
  }

  return getDocumentTypeLabel(documentType);
};

/**
 * Guarantee the document has a top-level <h1> title that names the document TYPE.
 *
 * Some templates only carry an <h2>{{PROJECT_TITLE}}</h2> heading and no <h1>.
 * That makes the rendered document show the *project* name instead of the
 * document type (e.g. "Technical Proposal"), and it leaves the title page
 * without a clear heading. When the assembled content has no <h1>, we prepend
 * one built from the document-type label, reusing the template's heading style
 * when available so the injected title matches the template's look.
 *
 * No-ops when an <h1> already exists, so well-formed templates are untouched.
 */
export const ensureDocumentTitleHeading = (
  html: string,
  documentType: string,
  templateHtml?: string,
): string => {
  if (!html?.trim()) return html;
  if (/<h1[^>]*>/i.test(html)) return html;

  const titleHtml = buildDocumentTitleHtml(getDocumentTypeLabel(documentType), templateHtml);
  return `${titleHtml}\n${html}`;
};

/**
 * Assess whether a template can actually produce a non-empty document, so the
 * real cause is logged up front instead of surfacing as a cryptic
 * "content too short" failure after 3 wasted retries.
 *
 * A template is generatable if it has EITHER:
 *   - a {{CONTENT}} / [CONTENT:] placeholder (single-shot fill), OR
 *   - at least one <h2> section carrying a placeholder (section-by-section).
 * Templates with only static headings and no placeholder rely entirely on the
 * KB/tools returning content — which fails when the KB is empty.
 */
export const assessTemplateHealth = (templateHtml: string | null): {
  ok: boolean;
  warnings: string[];
} => {
  const warnings: string[] = [];
  if (!templateHtml?.trim()) {
    return { ok: true, warnings }; // No template → default template path handles it.
  }

  // A {{CONTENT}}/[CONTENT:] placeholder anywhere makes the template fillable
  // (single-shot or section-by-section). Static <h2> headings alone do NOT —
  // those sections rely entirely on KB/tool output and yield nothing when the
  // KB is empty. This is exactly the broken dev "Test Tech Proposal" case.
  const hasContentPlaceholder = /\{\{CONTENT\}\}|\[CONTENT:|\[placeholder\]|\[Your /i.test(templateHtml);
  const hasH1 = /<h1[^>]*>/i.test(templateHtml);

  if (!hasContentPlaceholder) {
    warnings.push(
      'Template has no {{CONTENT}} placeholder and no fillable sections — generation depends entirely on KB/tool output and will fail when the knowledge base is empty.',
    );
  }
  if (!hasH1) {
    warnings.push(
      'Template has no <h1> document-type title — a title heading will be injected from the document type.',
    );
  }

  return { ok: warnings.length === 0, warnings };
};

/**
 * Clean generated HTML: strip scaffold comments while preserving template elements.
 * IMPORTANT: Only strips well-formed (closed) HTML comments to avoid eating template content.
 * Strips [CONTENT: ...] wrappers — extracts the inner content and removes the markers.
 * Does NOT replace \\n or \\t — those are JSON escape artifacts that should be handled
 * during JSON parsing, not in HTML post-processing.
 * 
 * Validates that preserved elements (images, styles) are still present after generation.
 */
export const cleanGeneratedHtml = (html: string): string => {
  if (!html?.trim()) return html;

  // Count preserved elements before cleaning for validation
  const imageCount = (html.match(/<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->/gi) || []).length;
  const styleBlockCount = (html.match(/<!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->/gi) || []).length;
  const styleLinkCount = (html.match(/<!-- PRESERVE THIS STYLE LINK EXACTLY AS-IS -->/gi) || []).length;
  const styledElementCount = (html.match(/<!-- PRESERVE STYLING -->/gi) || []).length;

  // Count actual preserved elements (images with s3key, style blocks, etc.)
  const actualImages = (html.match(/<img[^>]*?(?:src="s3key:[^"]*"|data-s3-key="[^"]*")[^>]*?>/gi) || []).length;
  const actualStyleBlocks = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).length;
  const actualStyleLinks = (html.match(/<link[^>]*?(?:rel="stylesheet"|type="text\/css")[^>]*?>/gi) || []).length;

  // Log validation results
  if (imageCount > 0) {
    console.log(`[cleanGeneratedHtml] Image preservation: ${actualImages}/${imageCount} images preserved`);
    if (actualImages < imageCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${imageCount - actualImages} images were lost during generation`);
    }
  }

  if (styleBlockCount > 0) {
    console.log(`[cleanGeneratedHtml] Style block preservation: ${actualStyleBlocks}/${styleBlockCount} style blocks preserved`);
    if (actualStyleBlocks < styleBlockCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${styleBlockCount - actualStyleBlocks} style blocks were lost during generation`);
    }
  }

  if (styleLinkCount > 0) {
    console.log(`[cleanGeneratedHtml] Style link preservation: ${actualStyleLinks}/${styleLinkCount} style links preserved`);
    if (actualStyleLinks < styleLinkCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${styleLinkCount - actualStyleLinks} style links were lost during generation`);
    }
  }

  let cleaned = html
    // Strip well-formed scaffold comments (properly terminated with -->)
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE BLOCK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE LINK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE STYLING\s*-->\s*/gi, '')
    .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
    // Strip unclosed scaffold comments (no --> terminator) — strip from <!-- to end of line
    // Critical: an unclosed <!-- makes the browser hide all content after it
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE STYLING[^\n]*\n?/gi, '')
    .replace(/<!--\s*Section guidance:[^\n]*\n?/gi, '');

  // Strip the [CONTENT: ...] placeholder when its inner text is the prompt
  // instruction itself ("Write the complete document content...") — that means
  // the AI echoed the placeholder verbatim instead of generating content.
  // Removing the whole block (instead of unwrapping it) prevents prompt
  // instructions from leaking into the final document.
  cleaned = cleaned.replace(
    /\[CONTENT:\s*Write the complete document content[\s\S]*?\]/gi,
    '',
  );
  // For other [CONTENT: ...] wrappers (where the AI put real content inside the
  // markers instead of replacing them), keep the inner content.
  cleaned = cleaned.replace(/\[CONTENT:\s*([\s\S]*?)\]/gi, '$1');
  // Defense-in-depth: even when the AI dropped the brackets but reproduced the
  // exact instruction text, strip the standalone sentence so it never reaches
  // the rendered document. Match the literal opening that's unique enough to
  // not collide with legitimate prose.
  cleaned = cleaned.replace(
    /Write the complete document content here based on the solicitation requirements and provided context\.[^<]*?(?:exactly as they appear\.|Include appropriate headings, sections, and structure\.)/gi,
    '',
  );

  // Strip leaked scaffold instruction text that the AI reproduced without HTML comment markers.
  // These are fragments from the TEMPLATE SCAFFOLD comment that leak into the output.
  cleaned = cleaned.replace(/\s*with a complete,?\s*well-structured HTML document body[^.>]*\.\s*(?:Keep all other text and elements[^.>]*\.\s*)?(?:PRESERVE ALL marked elements[^.>]*\.\s*)?(?:-->\s*)?/gi, '');
  cleaned = cleaned.replace(/\s*Replace \[CONTENT:[^\]]*\][^.>]*\.\s*/gi, '');
  cleaned = cleaned.replace(/\s*PRESERVE ALL marked elements exactly as-is\.?\s*(?:-->\s*)?/gi, '');
  // Strip any trailing --> that was part of a scaffold comment the AI partially reproduced
  cleaned = cleaned.replace(/\s*-->\s*$/g, '');

  return cleaned;
};

/**
 * Strip images from HTML that already exist in a template.
 * Used before injecting AI output into a template with [CONTENT: ...] placeholder —
 * the template already has images outside the placeholder, so the AI's copies
 * of those images must be removed to prevent duplication.
 *
 * @param html - The AI-generated HTML that may contain template images
 * @param templateHtml - The template HTML containing the authoritative images
 * @returns The HTML with template images removed
 */
export const stripTemplateImagesFromContent = (html: string, templateHtml: string): string => {
  if (!html?.trim() || !templateHtml?.trim()) return html;

  // Extract all image src values from the template
  const templateImageSrcs = [...templateHtml.matchAll(/<img[^>]*src="([^"]*)"[^>]*>/gi)]
    .map(m => m[1]!)
    .filter(Boolean);

  if (templateImageSrcs.length === 0) return html;

  let result = html;
  let removedCount = 0;

  for (const src of templateImageSrcs) {
    const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove <img> tags (and optional preceding preservation comments) that match template images
    const imgPattern = new RegExp(`\\s*(?:<!--[^>]*-->\\s*)?<img[^>]*src="${escapedSrc}"[^>]*>\\s*`, 'gi');
    const before = result;
    result = result.replace(imgPattern, '');
    if (result !== before) removedCount++;
  }

  if (removedCount > 0) {
    console.log(`[stripTemplateImagesFromContent] Stripped ${removedCount} template image(s) from AI output before injection`);
  }

  return result;
};

// ─── Template Style Reconciliation ────────────────────────────────────────────

/**
 * CSS properties that describe per-element LAYOUT rather than the template's
 * visual "brand" (colors, fonts). These MUST NOT be broadcast from one
 * representative element to every element of the same tag — doing so was the
 * root cause of the "everything is center-aligned" bug: the template's first
 * styled <p> (a centered title line) and first styled <td> (a centered number
 * cell) had their `text-align:center` copied onto every AI paragraph and every
 * unstyled table cell (including the left-aligned Description column).
 *
 * Alignment/spacing legitimately varies per element, so we strip these before
 * broadcasting and keep only cosmetic properties (color, background, font-*).
 */
const LAYOUT_STYLE_PROPS = new Set([
  'text-align',
  'vertical-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'width',
  'height',
  'float',
  'display',
]);

/** Parse a `style="..."` string into an ordered list of `[prop, value]` pairs. */
const parseStyleDecls = (style: string): Array<[string, string]> =>
  style
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return null;
      return [decl.slice(0, idx).trim().toLowerCase(), decl.slice(idx + 1).trim()] as [string, string];
    })
    .filter((d): d is [string, string] => d !== null);

/** Serialize `[prop, value]` pairs back into a `style` attribute value. */
const serializeStyleDecls = (decls: Array<[string, string]>): string =>
  decls.map(([prop, value]) => `${prop}: ${value}`).join('; ');

/** Remove layout/positioning declarations, keeping only cosmetic (brand) ones. */
const stripLayoutProps = (style: string): string =>
  serializeStyleDecls(parseStyleDecls(style).filter(([prop]) => !LAYOUT_STYLE_PROPS.has(prop)));

/**
 * The AI's prompt-default header coloring: white (or near-white) text and a dark
 * (#333/#000/black) background. Defined once and shared by every check/strip so
 * the white-text and dark-background patterns cannot drift apart — both are
 * anchored with `$` so prefix look-alikes like `#0000ff` or `#3333cc` are NOT
 * mistaken for the invented dark values.
 */
const INVENTED_WHITE_TEXT_RE = /^(#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;
const INVENTED_DARK_BG_RE = /^(#333(?:333)?|#000(?:000)?|black|rgb\(\s*(?:51|0)\s*,\s*(?:51|0)\s*,\s*(?:51|0)\s*\))$/i;

/** True when a style declares white (or near-white) text — the AI's default header color. */
const declaresWhiteText = (style: string): boolean =>
  parseStyleDecls(style).some(
    ([prop, value]) => prop === 'color' && INVENTED_WHITE_TEXT_RE.test(value.trim()),
  );

/** True when a style declares a dark (#333/#000/black) background — the AI's default header band. */
const declaresDarkBackground = (style: string): boolean =>
  parseStyleDecls(style).some(
    ([prop, value]) => (prop === 'background' || prop === 'background-color') && INVENTED_DARK_BG_RE.test(value.trim()),
  );

/** True when a style carries EITHER half of the AI's invented white-on-dark header look. */
const declaresInventedHeaderStyle = (style: string): boolean =>
  declaresWhiteText(style) || declaresDarkBackground(style);

/**
 * True when the template itself styles table headers with the white-on-dark look
 * (white text and/or a dark band) — i.e. it's intentional and must be preserved
 * rather than stripped. Checks the header-level tags where such styling could
 * live (<tr>/<thead>/<th>).
 */
const templateUsesInventedHeaderStyle = (templateHtml: string): boolean => {
  const headerTagRe = /<(?:tr|thead|th)(\s[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = headerTagRe.exec(templateHtml)) !== null) {
    const style = /style="([^"]*)"/i.exec(m[1] ?? '')?.[1];
    if (style && declaresInventedHeaderStyle(style)) return true;
  }
  return false;
};

/**
 * Strip AI-invented header coloring (white text + dark background) that the
 * template header does NOT use. The document-generation prompt tells the model
 * to render tables with `<tr style="background:#333;color:#fff">`, so the AI
 * frequently emits white-on-dark headers even when the template's headers are
 * plain black-on-white. This removes those specific declarations from a style
 * string, leaving all other properties intact.
 */
const stripInventedHeaderColors = (style: string): string =>
  serializeStyleDecls(
    parseStyleDecls(style).filter(([prop, value]) => {
      if (prop === 'color' && INVENTED_WHITE_TEXT_RE.test(value.trim())) {
        return false;
      }
      if ((prop === 'background' || prop === 'background-color') && INVENTED_DARK_BG_RE.test(value.trim())) {
        return false;
      }
      return true;
    }),
  );

/**
 * Replace the `style="..."` attribute on a matched open tag (or add one).
 * The strip regex requires `style` at an attribute boundary (start of the attr
 * string or after whitespace) so it never matches inside `data-style="..."` or
 * any other `*-style="..."` attribute and leaves a dangling `data-` fragment.
 */
const withStyleAttr = (attrs: string, style: string): string => {
  const cleaned = attrs.replace(/(^|\s)style="[^"]*"/gi, '$1').trim();
  const space = cleaned ? ' ' : '';
  return style ? ` style="${style}"${space}${cleaned}` : (cleaned ? ` ${cleaned}` : '');
};

/**
 * Collect a representative inline style per tag from the original template.
 * TipTap stores styles either directly on the element (`<h2 style="...">`) or
 * on a nested span (`<h2><span style="...">`). First match per tag wins.
 */
const collectTemplateStyles = (templateHtml: string): Map<string, string> => {
  const styleMap = new Map<string, string>();

  const directStyleRegex = /<(h[1-6]|p|ul|ol|li|strong|em|a|td|th|table)\s+[^>]*style="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = directStyleRegex.exec(templateHtml)) !== null) {
    const tag = m[1]!.toLowerCase();
    if (!styleMap.has(tag)) styleMap.set(tag, m[2]!);
  }

  const spanInHeadingRegex = /<(h[1-6])[^>]*>\s*<span\s+[^>]*style="([^"]*)"[^>]*>/gi;
  while ((m = spanInHeadingRegex.exec(templateHtml)) !== null) {
    const tag = m[1]!.toLowerCase();
    if (!styleMap.has(tag)) styleMap.set(tag, m[2]!);
  }

  return styleMap;
};

/**
 * Reconcile AI-generated content with the original template's visual design.
 *
 * Fixes two distinct template-fidelity bugs:
 *
 * 1. **Alignment broadcast** — the previous implementation copied the first
 *    styled element's ENTIRE style (including `text-align`) onto every element
 *    of that tag, so a centered title paragraph made every paragraph centered
 *    and a centered number cell made every unstyled cell (Description column
 *    included) centered. We now strip layout props before broadcasting, so only
 *    cosmetic/brand styling (color, font) propagates and per-element alignment
 *    is left intact.
 *
 * 2. **White table headers** — the AI regenerates tables with its prompt-default
 *    `color:#fff;background:#333` header styling. We force the template's own
 *    `<th>` style back on (when the template defines one), and otherwise strip
 *    the invented white-text/dark-background declarations so headers render in
 *    the template's plain black-on-white.
 */
export const applyTemplateStylesToContent = (
  content: string,
  templateHtml: string,
): string => {
  if (!content?.trim() || !templateHtml?.trim()) return content;

  const styleMap = collectTemplateStyles(templateHtml);
  let styled = content;

  for (const [tag, rawStyle] of styleMap) {
    const brandStyle = stripLayoutProps(rawStyle);
    if (!brandStyle) continue;

    if (tag.startsWith('h')) {
      // Headings: apply the template's brand style (color/font), replacing any
      // AI-generated style, but preserve the element's own text-align if it set one.
      styled = styled.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'), (match, attrs: string | undefined) => {
        const ownStyle = /style="([^"]*)"/i.exec(attrs ?? '')?.[1] ?? '';
        const ownAlign = parseStyleDecls(ownStyle).find(([prop]) => prop === 'text-align');
        const merged = ownAlign ? `${brandStyle}; text-align: ${ownAlign[1]}` : brandStyle;
        return `<${tag}${withStyleAttr(attrs ?? '', merged)}>`;
      });
    } else if (tag === 'th') {
      // Table headers: force the template's <th> style so the AI's white-on-dark
      // header is overwritten by the template's (typically black) header styling.
      styled = styled.replace(/<th(\s[^>]*)?>/gi, (match, attrs: string | undefined) => {
        return `<th${withStyleAttr(attrs ?? '', brandStyle)}>`;
      });
    } else {
      // Other tags: only style elements that have no style of their own, so we
      // never override alignment/spacing the AI (or template) set deliberately.
      styled = styled.replace(new RegExp(`<${tag}(?![^>]*style=)(\\s[^>]*)?>`, 'gi'), (match, attrs: string | undefined) => {
        return `<${tag}${withStyleAttr(attrs ?? '', brandStyle)}>`;
      });
    }
  }

  // White-header reconciliation. The generation prompt tells the AI to render
  // table headers as `<tr style="background:#333;color:#fff">`, so the invented
  // styling usually lives on the header ROW (cascading to the <th>s). But the AI
  // sometimes SPLITS it — the dark background on <tr>, the white text on <th> —
  // so we must strip either half wherever it appears. When the template's own
  // headers are NOT white-on-dark, strip the invented white-text AND
  // dark-background declarations from every header-level tag (<tr>/<thead>/<th>)
  // so headers render in the template's plain black-on-white.
  if (!templateUsesInventedHeaderStyle(templateHtml)) {
    styled = styled.replace(/<(tr|thead|th)(\s[^>]*)?>/gi, (match, tag: string, attrs: string | undefined) => {
      const ownStyle = /style="([^"]*)"/i.exec(attrs ?? '')?.[1];
      if (!ownStyle || !declaresInventedHeaderStyle(ownStyle)) return match;
      return `<${tag}${withStyleAttr(attrs ?? '', stripInventedHeaderColors(ownStyle))}>`;
    });
  }

  return styled;
};

// ─── Template-Based Section Generation ────────────────────────────────────────

/**
 * Generate a document using the template section-by-section strategy.
 *
 * This is the PRIMARY generation path when a template with <h2> sections exists.
 *
 * Flow:
 * 1. Parse template into sections (split on <h2> headings)
 * 2. Generate each section independently with AI + tools
 * 3. Merge generated sections into the final document
 * 4. Clean and return the final HTML
 */
export const generateWithTemplateSections = async (args: {
  templateHtml: string;
  systemPrompt: string;
  sectionSystemPrompt: string;
  userPrompt: string;
  documentType: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
}): Promise<RFPDocumentContent | null> => {
  const { templateHtml, sectionSystemPrompt, userPrompt, documentType, orgId, projectId, opportunityId, documentId, qaPairs } = args;

  // 1. Parse template into sections
  const templateSections = parseTemplateSections(templateHtml);
  if (!templateSections || templateSections.length === 0) {
    console.log(`[template-gen] Template has no sections — falling back to single-shot generation`);
    return null; // Fall through to single-shot
  }

  // Check if any section has placeholders that need AI generation.
  // If no section has placeholders, fall back to single-shot so the AI generates
  // actual content for the document type instead of just returning the template.
  const anySectionHasPlaceholders = templateSections.some(s =>
    s.templateContent && /\[CONTENT:|\[placeholder\]|\[Your /i.test(s.templateContent),
  );
  if (!anySectionHasPlaceholders) {
    console.log(`[template-gen] No sections have placeholders — falling back to single-shot generation`);
    return null; // Fall through to single-shot
  }

  console.log(`[template-gen] Using section-by-section generation: ${templateSections.length} sections from template`);
  console.log(`[template-gen] Sections:`, JSON.stringify(templateSections.map(s => ({ title: s.title, description: s.description })), null, 2));

  // 2. Generate each section independently with AI + tools
  const htmlFragments = await generateDocumentSectionBySectionHtml({
    modelId: BEDROCK_MODEL_ID,
    systemPrompt: sectionSystemPrompt,
    initialUserPrompt: userPrompt,
    sections: templateSections,
    orgId,
    projectId,
    opportunityId,
    documentId,
    qaPairs,
    maxTokensPerSection: 6000,
    temperature: TEMPERATURE,
    maxToolRoundsPerSection: 2,
  });

  if (!htmlFragments.length) {
    console.error(`[template-gen] Section-by-section generation produced no content`);
    return null;
  }

  // 3. Merge sections back into template structure
  const rawStitchedHtml = injectSectionsIntoTemplate(templateHtml, htmlFragments);
  const stitchedHtml = cleanGeneratedHtml(rawStitchedHtml);

  // 3b. Guard: when the KB/tools return nothing AND the template sections carry no
  // real placeholder content, every section falls back to (empty) template content
  // and the stitched doc is near-empty. Returning it here would block the single-shot
  // path and burn all 3 retries on a doc that can never pass validation. Instead,
  // fall through to single-shot, which can still write from the solicitation + Q&A
  // even with an empty knowledge base.
  const stitchedValidation = validateGeneratedContent(stitchedHtml);
  if (!stitchedValidation.isValid) {
    console.warn(
      `[template-gen] Section-by-section output failed validation (${stitchedValidation.reason}) — falling back to single-shot generation`,
    );
    return null;
  }

  // 4. Extract title and build final document
  const docTitle = extractDocumentTitle(templateHtml, documentType);

  console.log(`[template-gen] Section-by-section complete: ${htmlFragments.length} sections, ${stitchedHtml.length} chars total`);

  return {
    title: docTitle,
    content: stitchedHtml,
  };
};

// ─── Single-Shot Generation (with tool-use loop) ─────────────────────────────

/**
 * Generate a document using a single AI conversation with tool-use loop.
 *
 * Used when:
 * - Template is a simple wrapper (no <h2> sections, just {{CONTENT}} placeholder)
 * - No template exists (uses default template)
 *
 * The AI generates the entire document in one conversation, with up to
 * MAX_TOOL_ROUNDS of tool-use iterations to gather context.
 */
export const generateSingleShot = async (args: {
  templateHtml: string;
  systemPrompt: string;
  userPrompt: string;
  documentType: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
  enrichedKbTextLength: number;
}): Promise<RFPDocumentContent | null> => {
  const { templateHtml, systemPrompt, userPrompt, documentType, orgId, projectId, opportunityId, documentId, qaPairs, enrichedKbTextLength } = args;

  console.log(`[single-shot] Using single-shot generation with template scaffold (${templateHtml.length} chars)`);

  const baseMaxTokens = TABLE_HEAVY_TYPES.has(documentType) ? Math.max(MAX_TOKENS, 16000) : MAX_TOKENS;
  const effectiveMaxTokens = enrichedKbTextLength > 1000 ? Math.max(baseMaxTokens, 8000) : baseMaxTokens;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];

  let rawText = '';
  let toolRounds = 0;

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    const isLastRound = toolRounds >= MAX_TOOL_ROUNDS;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages,
      max_tokens: effectiveMaxTokens,
      temperature: TEMPERATURE,
    };

    if (!isLastRound) {
      requestBody.tools = DOCUMENT_TOOLS;
    }

    const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody));

    const stopReason: string = parsed.stop_reason ?? 'end_turn';
    const content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> =
      parsed.content ?? [];

    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`[single-shot] Tool use round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

      messages.push({ role: 'assistant', content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(block =>
          executeDocumentTool({
            toolName: block.name ?? '',
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            toolUseId: block.id ?? '',
            orgId,
            projectId,
            opportunityId,
            documentId,
            qaPairs,
          }),
        ),
      );

      messages.push({
        role: 'user',
        content: toolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      });

      toolRounds++;
      continue;
    }

    rawText = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
      .trim();

    if (!rawText) {
      rawText = extractBedrockText(parsed);
    }

    // If last round still returned tool_use, force a final generation request
    if (!rawText && stopReason === 'tool_use' && isLastRound) {
      console.warn('[single-shot] Last round still returned tool_use — sending final generation request without tools');
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Now generate the complete document JSON based on all the information gathered.' }],
      });
      const finalBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: systemPrompt }],
        messages,
        max_tokens: effectiveMaxTokens,
        temperature: TEMPERATURE,
      };
      const finalResponse = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(finalBody));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse));
      const finalContent: Array<{ type: string; text?: string }> = finalParsed.content ?? [];
      rawText = finalContent.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim()
        || extractBedrockText(finalParsed);
    }

    console.log(`[single-shot] Generation complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    break;
  }

  // Parse model JSON — with fallback for plain-text/HTML responses
  let modelJson: unknown;
  try {
    modelJson = safeParseJsonFromModel(rawText);

    // Check if the model returned a JSON structure as text instead of structured data
    if (typeof modelJson === 'object' && modelJson !== null) {
      const obj = modelJson as Record<string, unknown>;
      const htmlField = obj.htmlContent || obj.content;
      if (typeof htmlField === 'string' && htmlField.trim().startsWith('{')) {
        try {
          const innerParsed = JSON.parse(htmlField);
          if (innerParsed && typeof innerParsed === 'object' && (innerParsed.content || innerParsed.htmlContent)) {
            console.warn('[single-shot] Detected JSON-as-text in content field, extracting actual HTML');
            modelJson = innerParsed;
          }
        } catch {
          // Not valid JSON, continue with the original
        }
      }
    }
  } catch (parseErr) {
    console.warn(`[single-shot] safeParseJsonFromModel failed: ${(parseErr as Error).message}. Wrapping raw text as HTML.`);
    modelJson = { title: getDocumentTypeLabel(documentType), htmlContent: rawText };
  }

  // Validate model output against RFPDocumentContent schema
  const { success, data, error } = RFPDocumentContentSchema.safeParse(modelJson);
  if (!success) {
    console.error('[single-shot] Document validation failed', error, { modelJson });
    return null;
  }

  // Ensure htmlContent is present
  const normalizedDocument = ensureHtmlContent(data, templateHtml);

  let finalHtml = normalizedDocument.content ?? '';
  console.log(`[single-shot] After ensureHtmlContent: ${finalHtml.length} chars`);

  // For real templates, inject the AI-generated content into the template to
  // preserve images, logos, styles, and boilerplate.
  // Only do this for real templates — not the default template (which is just a scaffold).
  const isDefaultTemplate = templateHtml.length < 500; // Default template is ~350 chars

  if (!isDefaultTemplate) {
    // Strategy 1: Template has [CONTENT: ...] placeholder — inject into that placeholder
    const templateHasContentPlaceholder = /\[CONTENT:\s*[^\]]*\]/i.test(templateHtml);
    if (templateHasContentPlaceholder) {
      console.log('[single-shot] Real template with [CONTENT: ...] placeholder — injecting AI content into template');
      // Strip template images from AI output BEFORE injection.
      // The AI is told to "preserve images", so it includes them in its output.
      // But the template already has those images OUTSIDE the [CONTENT: ...] placeholder.
      // Injecting the AI output (with images) into the template (which also has images)
      // would cause duplication. Remove the AI's copies — the template's are authoritative.
      const cleanedAiContent = stripTemplateImagesFromContent(finalHtml, templateHtml);
      const injected = injectContentIntoSimpleTemplate(templateHtml, cleanedAiContent);
      if (injected) {
        finalHtml = injected;
        console.log(`[single-shot] Injected content into template (${finalHtml.length} chars)`);
      } else {
        console.warn('[single-shot] injectContentIntoSimpleTemplate returned null, using AI output as-is');
      }
    } else {
      // Strategy 2: Template has no [CONTENT: ...] placeholder but has structure (h1, images, styles).
      // The AI should have generated content following the template structure.
      // Check if the AI output already contains the template's key elements (images, styles).
      // If not, prepend the template's header content (before first h2) to preserve images/styles.
      const templateHasImages = /<img[^>]*(?:src="s3key:|data-s3-key=")[^>]*>/i.test(templateHtml);
      const templateHasStyles = /<style[^>]*>/i.test(templateHtml);
      const aiOutputHasImages = /<img[^>]*(?:src="s3key:|data-s3-key=")[^>]*>/i.test(finalHtml);
      const aiOutputHasStyles = /<style[^>]*>/i.test(finalHtml);

      if ((templateHasImages && !aiOutputHasImages) || (templateHasStyles && !aiOutputHasStyles)) {
        console.log('[single-shot] AI output missing template images/styles — prepending template header');
        // Extract content before first h2 from template (header with images, styles, h1)
        const firstH2Match = templateHtml.match(/<h2[^>]*>/i);
        if (firstH2Match?.index && firstH2Match.index > 0) {
          const templateHeader = templateHtml.substring(0, firstH2Match.index).trim();
          if (templateHeader) {
            finalHtml = templateHeader + '\n\n' + finalHtml;
            console.log(`[single-shot] Prepended template header (${templateHeader.length} chars)`);
          }
        }
      }
    }
  }

  finalHtml = cleanGeneratedHtml(finalHtml);

  return {
    ...normalizedDocument,
    content: finalHtml,
  };
};

// ─── Process Job (Core Logic) ─────────────────────────────────────────────────

/**
 * Core job processing logic for document generation.
 *
 * Decision tree for generation strategy:
 *   1. CLARIFYING_QUESTIONS → No AI, format existing data
 *   2. Template with <h2> sections (>1 section) → Section-by-section generation
 *   3. Template with {{CONTENT}} placeholder → Single-shot + inject into template
 *   4. No template → Single-shot with default template
 */
export const processJobInner = async (job: Job): Promise<void> => {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId, options } = job;

  // ─── CLARIFYING_QUESTIONS: No AI — format existing data ───
  if (documentType === 'CLARIFYING_QUESTIONS') {
    const { generateClarifyingQuestionsDocument } = await import('@/helpers/clarifying-questions-document');
    await generateClarifyingQuestionsDocument({
      orgId,
      projectId,
      opportunityId,
      documentId,
      templateId,
      options: options as Parameters<typeof generateClarifyingQuestionsDocument>[0]['options'],
    });
    return;
  }

  // ─── QUESTIONS_AND_ANSWERS: No AI — format existing Q&A data ───
  if (documentType === 'QUESTIONS_AND_ANSWERS') {
    const { generateQaDocument } = await import('@/helpers/qa-questions-document');
    await generateQaDocument({ orgId, projectId, opportunityId, documentId, templateId });
    return;
  }

  // ─── QUESTIONNAIRE: Fill XLSX or generate formatted Q&A document ───
  if (documentType === 'QUESTIONNAIRE') {
    // Try to find the source questionnaire file to determine format
    const { queryAllBySkPrefix } = await import('@/helpers/db');
    const { QUESTION_FILE_PK } = await import('@/constants/question-file');

    const skPrefix = `${projectId}#${opportunityId}#`;
    const questionFiles = await queryAllBySkPrefix<{
      questionFileId: string;
      docType?: string;
      originalFileName?: string;
      fileKey?: string;
      answerColumn?: string;
      firstDataRow?: number;
    }>(QUESTION_FILE_PK, skPrefix);

    const questionnaireFiles = questionFiles.filter(f => f.docType === 'QUESTIONNAIRE');

    // Check if we have an XLSX questionnaire file that can be auto-filled
    const xlsxFile = questionnaireFiles.find(f => {
      const fileName = (f.originalFileName ?? f.fileKey ?? '').toLowerCase();
      const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      return isXlsx && f.answerColumn && f.firstDataRow && f.fileKey;
    });

    if (xlsxFile) {
      // XLSX questionnaire — fill the original spreadsheet with answers
      console.log(`XLSX questionnaire detected (${xlsxFile.originalFileName}), using fill-in-place logic`);
      const { generateQuestionnaireDocument } = await import('@/helpers/questionnaire-document');
      await generateQuestionnaireDocument({ orgId, projectId, opportunityId, documentId });
    } else {
      // DOCX questionnaire or no source file — generate formatted Q&A document
      console.log(`Non-XLSX questionnaire detected, generating formatted Q&A document with template support`);
      const { generateQaDocument } = await import('@/helpers/qa-questions-document');
      await generateQaDocument({ orgId, projectId, opportunityId, documentId, templateId });
    }
    return;
  }

  // ─── Step 1: Load Q&A pairs ───
  const qaPairs = await loadQaPairs(projectId, opportunityId);

  // ─── Step 2: Load solicitation text ───
  const solicitation = await loadSolicitation(projectId, opportunityId);

  // ─── Step 3: Build macro values from real project/org/opportunity data ───
  const macroValues = await buildMacroValues({ orgId, projectId, opportunityId });
  console.log(`Built macro values for documentId=${documentId}:`, Object.keys(macroValues));

  // ─── Step 4: Gather enrichment context + resolve template HTML in parallel ───
  // The furniture lookup rides along here so it costs no extra wall-clock.
  const [enrichedKbText, templateHtmlScaffold, templateFurniture] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateHtml(orgId, documentType, templateId, macroValues),
    resolveTemplateFurniture(orgId, documentType, templateId, macroValues),
  ]);

  if (templateHtmlScaffold) {
    console.log(`Using HTML template scaffold for documentId=${documentId} (${templateHtmlScaffold.length} chars)`);
    const { ok, warnings } = assessTemplateHealth(templateHtmlScaffold);
    if (!ok) {
      console.warn(
        `[worker] Template health check for documentId=${documentId} (type=${documentType}, templateId=${templateId ?? 'auto'}): ${warnings.join(' ')}`,
      );
    }
  }

  // ─── Step 4b: Load ORIGINAL template HTML (without scaffold preprocessing) ───
  // This is used for the final document assembly to guarantee all template elements
  // (images, styles, structure) are preserved exactly as-is.
  // The scaffold version (templateHtmlScaffold) is only for the AI to see the structure.
  let originalTemplateHtml: string | null = null;
  if (templateHtmlScaffold) {
    try {
      const template = templateId
        ? await getTemplate(orgId, templateId)
        : await findBestTemplate(orgId, documentType);
      if (template?.htmlContentKey) {
        const rawHtml = await loadTemplateHtml(template.htmlContentKey);
        if (rawHtml?.trim()) {
          // Apply macro replacements to the original template (resolve {{COMPANY_NAME}} etc.)
          // but do NOT add scaffold comments or preservation markers
          originalTemplateHtml = replaceMacros(rawHtml, macroValues, { removeUnresolved: false });
          // Replace remaining unresolved macros with readable labels
          originalTemplateHtml = originalTemplateHtml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_: string, key: string) =>
            `[${key.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}]`,
          );
          console.log(`[worker] Loaded original template HTML: ${originalTemplateHtml.length} chars (for final assembly)`);
        }
      }
    } catch (err) {
      console.warn(`[worker] Failed to load original template HTML: ${(err as Error).message}`);
    }
  }

  // ─── Step 5: Build prompts ───
  // Org-level fragment overrides are fetched once per job; null fields fall back
  // to the hardcoded defaults inside the builders.
  const fragments = await resolveDocumentPromptFragments(orgId, documentType);
  const systemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold, fragments.guidance);
  const userPrompt = buildUserPromptForDocumentType(
    documentType,
    solicitation,
    JSON.stringify(qaPairs),
    enrichedKbText,
    fragments.task,
  );

  console.log(`Prompt sizes: system=${systemPrompt.length}, user=${userPrompt.length}, solicitation=${solicitation.length}, qaPairs=${qaPairs.length}, enrichedKb=${enrichedKbText.length}`);

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: 'Prompt generation failed' },
      updatedBy: 'system',
    });
    return;
  }

  // ─── Step 6: Choose generation strategy ───
  const effectiveTemplate = templateHtmlScaffold || buildDefaultTemplate();
  if (!templateHtmlScaffold) {
    console.warn(`No template found for documentId=${documentId}, type=${documentType} — using default template`);
  }

  let finalDocument: RFPDocumentContent | null = null;
  // Strategy 1: Section-by-section generation (template with headings AND placeholders)
  if (templateHtmlScaffold) {
    const sectionSystemPrompt = buildSectionSystemPrompt(documentType, fragments.guidance);
    console.log(`Section system prompt: ${sectionSystemPrompt.length} chars`);

    finalDocument = await generateWithTemplateSections({
      templateHtml: effectiveTemplate,
      systemPrompt,
      sectionSystemPrompt,
      userPrompt,
      documentType,
      orgId,
      projectId,
      opportunityId,
      documentId,
      qaPairs,
    });
  }

  // Strategy 2: Single-shot generation (template without h2 sections, or no template)
  // When a template exists but has no <h2> sections, we still pass it to the AI
  // so it can preserve images, logos, styles, and boilerplate from the template.
  if (!finalDocument) {
    const singleShotTemplate = templateHtmlScaffold || buildDefaultTemplate();
    // Pass the template scaffold to the system prompt so the AI sees the template structure
    const singleShotSystemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold ?? null, fragments.guidance);

    console.log(`[worker] Using single-shot generation for documentId=${documentId} (template: ${templateHtmlScaffold ? 'yes' : 'default'})`);
    finalDocument = await generateSingleShot({
      templateHtml: singleShotTemplate,
      systemPrompt: singleShotSystemPrompt,
      userPrompt,
      documentType,
      orgId,
      projectId,
      opportunityId,
      documentId,
      qaPairs,
      enrichedKbTextLength: enrichedKbText.length,
    });
  }

  // ─── Step 6b: Final assembly — use ORIGINAL template as wrapper ───
  // When a template exists, the final document MUST use the original template
  // as a wrapper to guarantee all template elements (images, styles, structure)
  // are preserved exactly as-is. The AI-generated content is injected into the
  // template structure.
  //
  // SKIP this step when the single-shot path already injected content into a
  // [CONTENT: ...] template. That injection already preserves the full template
  // structure (images, styles, boilerplate). Re-assembling here would duplicate
  // images by prepending the template header again.
  const originalTemplateHasContentPlaceholder = originalTemplateHtml
    ? /\{\{CONTENT\}\}|\[CONTENT:/i.test(originalTemplateHtml)
    : false;
  // Also check the scaffold version (which has [CONTENT: ...] after macro resolution)
  const scaffoldHasContentPlaceholder = templateHtmlScaffold
    ? /\[CONTENT:/i.test(templateHtmlScaffold)
    : false;
  const skipAssembly = originalTemplateHasContentPlaceholder || scaffoldHasContentPlaceholder;

  if (finalDocument?.content && originalTemplateHtml && !skipAssembly) {
    const aiContent = cleanGeneratedHtml(finalDocument.content);
    
    // Find the first heading of ANY level (h1-h6) in the original template
    const firstHeadingMatch = originalTemplateHtml.match(/<h[1-6][^>]*>/i);
    
    // HEADER: everything before the first heading (images, styles, logos, etc.)
    const templateHeader = firstHeadingMatch?.index && firstHeadingMatch.index > 0
      ? originalTemplateHtml.substring(0, firstHeadingMatch.index).trim()
      : '';
    
    // FOOTER: Find template content that the AI didn't generate.
    // Count headings in AI content vs template to detect missing sections.
    const aiHeadingCount = (aiContent.match(/<h[1-6][^>]*>/gi) || []).length;
    const templateHeadings = [...originalTemplateHtml.matchAll(/<h[1-6][^>]*>/gi)];
    const templateHeadingCount = templateHeadings.length;
    let templateFooter = '';
    
    console.log(`[worker] Heading count: AI=${aiHeadingCount}, template=${templateHeadingCount}`);
    
    if (templateHeadingCount > aiHeadingCount && aiHeadingCount > 0) {
      // Template has more headings than AI generated — append the missing sections
      // The missing sections start from the (aiHeadingCount)th heading in the template
      // (accounting for the header heading which is already in the template header)
      const headerHeadingCount = templateHeader ? (templateHeader.match(/<h[1-6][^>]*>/gi) || []).length : 0;
      const aiBodyHeadingCount = aiHeadingCount; // headings in AI body (after header strip)
      const expectedTemplateBodyHeadings = templateHeadingCount - headerHeadingCount;
      
      if (aiBodyHeadingCount < expectedTemplateBodyHeadings) {
        // Find the (aiBodyHeadingCount + headerHeadingCount)th heading in the template
        const missingFromIdx = aiBodyHeadingCount + headerHeadingCount;
        if (missingFromIdx < templateHeadings.length) {
          const missingStart = templateHeadings[missingFromIdx]!.index!;
          templateFooter = originalTemplateHtml.substring(missingStart).trim();
          console.log(`[worker] Found ${expectedTemplateBodyHeadings - aiBodyHeadingCount} missing template sections as footer: ${templateFooter.length} chars`);
        }
      }
    }
    
    // Fallback: Find the last heading in the AI content, locate it in the template,
    // and take everything from the template after that heading's section as footer.
    if (!templateFooter) {
      const aiLastHeadingMatch = [...aiContent.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
      if (aiLastHeadingMatch.length > 0) {
        const lastAiHeadingText = aiLastHeadingMatch[aiLastHeadingMatch.length - 1]![1]!
          .replace(/<[^>]+>/g, '').trim().substring(0, 50).toLowerCase();
        
        // Find this heading in the original template
        const templateAllHeadings = [...originalTemplateHtml.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
        for (let hi = templateAllHeadings.length - 1; hi >= 0; hi--) {
          const tplHeadingText = templateAllHeadings[hi]![1]!.replace(/<[^>]+>/g, '').trim().substring(0, 50).toLowerCase();
          if (tplHeadingText === lastAiHeadingText) {
            // Found the matching heading — check if there are more headings after it
            if (hi < templateAllHeadings.length - 1) {
              // There are more template headings after the last AI heading
              const nextTplHeading = templateAllHeadings[hi + 1]!;
              templateFooter = originalTemplateHtml.substring(nextTplHeading.index!).trim();
              console.log(`[worker] Found template tail after last AI heading: ${templateFooter.length} chars (${templateAllHeadings.length - hi - 1} extra sections)`);
            }
            break;
          }
        }
      }
    }
    
    // Last resort: check for any content after the very last closing tag
    if (!templateFooter) {
      const lastCloseTag = originalTemplateHtml.lastIndexOf('</');
      if (lastCloseTag >= 0) {
        const closeEnd = originalTemplateHtml.indexOf('>', lastCloseTag);
        if (closeEnd >= 0) {
          const afterLastTag = originalTemplateHtml.substring(closeEnd + 1).trim();
          if (afterLastTag) {
            templateFooter = afterLastTag;
            console.log(`[worker] Found content after last closing tag: ${templateFooter.length} chars`);
          }
        }
      }
    }
    
    // BODY: Use AI content, but strip any header the AI generated
    // (we use the template header instead to preserve images/styles)
    let aiBody = aiContent;
    if (templateHeader) {
      // Find the first heading in AI content and strip everything before it
      const aiFirstHeading = aiBody.match(/<h[1-6][^>]*>/i);
      if (aiFirstHeading?.index && aiFirstHeading.index > 0) {
        aiBody = aiBody.substring(aiFirstHeading.index);
        console.log(`[worker] Stripped AI header, using template header instead`);
      }
    }
    
    // DEDUPLICATE: Remove images from footer that already appear in the header.
    // Templates often have a company logo at the top; the footer detection may
    // grab template sections that also contain the same image, causing it to
    // appear at both the beginning and end of the document.
    if (templateFooter && templateHeader) {
      const headerImageSrcs = [...templateHeader.matchAll(/<img[^>]*src="([^"]*)"[^>]*>/gi)]
        .map(m => m[1]!);
      
      if (headerImageSrcs.length > 0) {
        let deduplicatedFooter = templateFooter;
        for (const src of headerImageSrcs) {
          // Escape special regex characters in the src
          const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Remove <img> tags from footer that have the same src as a header image
          const imgPattern = new RegExp(`\\s*(?:<!--[^>]*-->\\s*)?<img[^>]*src="${escapedSrc}"[^>]*>\\s*`, 'gi');
          deduplicatedFooter = deduplicatedFooter.replace(imgPattern, '');
        }
        
        if (deduplicatedFooter !== templateFooter) {
          const removedCount = (templateFooter.match(/<img[^>]*>/gi) || []).length - (deduplicatedFooter.match(/<img[^>]*>/gi) || []).length;
          console.log(`[worker] Deduplicated ${removedCount} image(s) from footer that already appear in header`);
          templateFooter = deduplicatedFooter;
        }
      }
    }
    
    // Also deduplicate images in the AI body that already appear in the header
    if (templateHeader) {
      const headerImageSrcs = [...templateHeader.matchAll(/<img[^>]*src="([^"]*)"[^>]*>/gi)]
        .map(m => m[1]!);
      
      if (headerImageSrcs.length > 0) {
        let deduplicatedBody = aiBody;
        for (const src of headerImageSrcs) {
          const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const imgPattern = new RegExp(`\\s*(?:<!--[^>]*-->\\s*)?<img[^>]*src="${escapedSrc}"[^>]*>\\s*`, 'gi');
          deduplicatedBody = deduplicatedBody.replace(imgPattern, '');
        }
        
        if (deduplicatedBody !== aiBody) {
          const removedCount = (aiBody.match(/<img[^>]*>/gi) || []).length - (deduplicatedBody.match(/<img[^>]*>/gi) || []).length;
          console.log(`[worker] Deduplicated ${removedCount} image(s) from AI body that already appear in header`);
          aiBody = deduplicatedBody;
        }
      }
    }
    
    // ASSEMBLE: template header + AI body + template footer
    let assembled = '';
    if (templateHeader) {
      assembled += templateHeader + '\n\n';
    }
    assembled += aiBody;
    if (templateFooter) {
      // Only append footer if it still has meaningful content after deduplication
      const footerText = templateFooter.replace(/<[^>]*>/g, '').trim();
      if (footerText) {
        assembled += '\n\n' + templateFooter;
      } else {
        console.log(`[worker] Skipping empty footer after deduplication`);
      }
    }
    
    console.log(`[worker] Final assembly: header(${templateHeader.length}) + body(${aiBody.length}) + footer(${templateFooter.length}) = ${assembled.length} chars`);
    finalDocument = { ...finalDocument, content: assembled };

    // Apply the original template's inline styles to the generated content so it
    // matches the template's visual design, and reconcile AI-invented table-header
    // styling (white-on-dark) with the template. See applyTemplateStylesToContent
    // for why per-element layout props (text-align) are deliberately NOT broadcast.
    const styledContent = applyTemplateStylesToContent(assembled, originalTemplateHtml);
    if (styledContent !== assembled) {
      console.log(`[worker] Applied template styles to generated content`);
      finalDocument = { ...finalDocument, content: styledContent };
    }
  }

  // ─── Step 6c: Guarantee a document-type <h1> title ───
  // Templates that only carry <h2>{{PROJECT_TITLE}}</h2> (and no <h1>) render the
  // project name as the heading and leave the title page without a clear title.
  // Inject an <h1> from the document-type label when none is present.
  if (finalDocument?.content) {
    const withTitle = ensureDocumentTitleHeading(
      finalDocument.content,
      documentType,
      originalTemplateHtml ?? templateHtmlScaffold ?? undefined,
    );
    if (withTitle !== finalDocument.content) {
      console.log(`[worker] Injected document-type <h1> title for documentId=${documentId} (template lacked <h1>)`);
      finalDocument = { ...finalDocument, content: withTitle };
    }
  }

  // ─── Step 7: Validate & Save result ───
  const htmlContent = finalDocument?.content ?? '';
  const contentText = htmlContent
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();

  if (!finalDocument || !contentText) {
    const reason = !finalDocument
      ? 'Document generation produced no content'
      : `Document generation produced empty content (raw length: ${htmlContent.length}, text length: ${contentText.length})`;
    console.error(`[worker] ${reason}`);
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: reason },
      updatedBy: 'system',
    });
    return;
  }

  console.log(`[worker] Final document: title="${finalDocument.title}", content=${htmlContent.length} chars`);

  // ─── Step 7a: Upload HTML to S3 ───
  let htmlContentKey: string;
  try {
    htmlContentKey = await uploadRFPDocumentHtml({
      orgId, projectId, opportunityId, documentId,
      html: htmlContent,
    });
    console.log(`[worker] HTML uploaded to S3: ${htmlContentKey} (${htmlContent.length} chars)`);
  } catch (err) {
    const msg = `Failed to upload HTML to S3: ${(err as Error).message}`;
    console.error(`[worker] ${msg}`);
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: msg },
      updatedBy: 'system',
    });
    return;
  }

  // ─── Step 7b: Update DynamoDB metadata (htmlContentKey only, no status change yet) ───
  // NOTE: Status stays GENERATING — the handler will set READY only after validation passes
  const dbContent = {
    title: finalDocument.title,
    customerName: finalDocument.customerName,
    opportunityId: finalDocument.opportunityId,
    outlineSummary: finalDocument.outlineSummary,
  };

  await updateRFPDocumentMetadata({
    projectId, opportunityId, documentId,
    updates: {
      // Don't set status here — let the handler set READY after validation passes
      generationError: '',
      content: dbContent,
      title: finalDocument.title || getDocumentTypeLabel(documentType),
      name: finalDocument.title || getDocumentTypeLabel(documentType),
      htmlContentKey,
      // Snapshot the template's header/footer onto the document — the export path
      // reads it from here, having no access to the template itself.
      ...(templateFurniture.templateId !== undefined && { templateId: templateFurniture.templateId }),
      ...(templateFurniture.furniture !== undefined && { furniture: templateFurniture.furniture }),
    },
    updatedBy: 'system',
  });

  console.log(`[worker] DynamoDB updated: htmlContentKey=${htmlContentKey} (status unchanged, pending validation)`);

  // ─── Step 7c: Create version snapshot ───
  try {
    const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);
    const latestVersionNum = await getLatestVersionNumber(projectId, opportunityId, documentId);
    const newVersionNumber = latestVersionNum + 1;

    const versionHtmlKey = await saveVersionHtml(
      orgId, projectId, opportunityId, documentId,
      newVersionNumber, htmlContent,
    );

    const versionId = uuidv4();
    await createVersion({
      versionId,
      documentId,
      projectId,
      opportunityId,
      orgId,
      versionNumber: newVersionNumber,
      htmlContentKey: versionHtmlKey,
      title: finalDocument.title ?? existingDoc?.title ?? existingDoc?.name ?? getDocumentTypeLabel(documentType),
      documentType: existingDoc?.documentType ?? documentType,
      wordCount: htmlContent.split(/\s+/).length,
      changeNote: newVersionNumber === 1 ? 'Initial AI generation' : 'AI regeneration',
      createdBy: existingDoc?.createdBy ?? 'system',
    });

    console.log(`[worker] Created version ${newVersionNumber} for document ${documentId}`);
  } catch (versionErr) {
    // Version creation is non-critical — log but don't fail the generation
    console.error('[worker] Failed to create version snapshot:', (versionErr as Error).message);
  }

  console.log(`[worker] Document generation complete for documentId=${documentId}`);
};
