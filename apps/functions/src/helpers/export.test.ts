/**
 * Tests for export helpers: estimateHeadingPages, extractHeadingsFromHtml, expandTableOfContents.
 */

// Mock AWS SDK and environment before imports
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({})),
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('./rfp-document', () => ({
  loadRFPDocumentHtml: jest.fn(),
}));

jest.mock('./env', () => ({
  requireEnv: jest.fn((key: string, fallback?: string) => fallback ?? `mock-${key}`),
}));

import { estimateHeadingPages, extractHeadingsFromHtml, expandTableOfContents, extractTocTitle } from './export';

describe('estimateHeadingPages', () => {
  it('returns empty array for empty HTML', () => {
    expect(estimateHeadingPages('')).toEqual([]);
    expect(estimateHeadingPages('', 1)).toEqual([]);
  });

  it('returns empty array for HTML with no headings', () => {
    const html = '<p>Just a paragraph with no headings at all.</p>';
    expect(estimateHeadingPages(html)).toEqual([]);
  });

  it('returns startPage for a single heading at the beginning', () => {
    const html = '<h1>Introduction</h1><p>Some content here.</p>';
    const pages = estimateHeadingPages(html, 2);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toBe(2);
  });

  it('assigns increasing page numbers for headings spread across content', () => {
    // Create HTML with enough content to span multiple pages (~3000 chars per page)
    const longParagraph = '<p>' + 'A'.repeat(2800) + '</p>';
    const html =
      '<h1>Chapter 1</h1>' +
      longParagraph +
      '<h2>Chapter 2</h2>' +
      longParagraph +
      '<h3>Chapter 3</h3>' +
      longParagraph;

    const pages = estimateHeadingPages(html, 1, 3000);
    expect(pages).toHaveLength(3);
    // First heading should be on page 1
    expect(pages[0]).toBe(1);
    // Subsequent headings should be on later pages
    expect(pages[1]).toBeGreaterThanOrEqual(pages[0]);
    expect(pages[2]).toBeGreaterThanOrEqual(pages[1]);
  });

  it('handles explicit page breaks correctly', () => {
    const html =
      '<h1>Before Break</h1>' +
      '<p>Some content.</p>' +
      '<div data-page-break="true"></div>' +
      '<h2>After Break</h2>' +
      '<p>More content.</p>';

    const pages = estimateHeadingPages(html, 1, 3000);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(1);
    // After a page break, the heading should be on the next page
    expect(pages[1]).toBe(2);
  });

  it('handles multiple page breaks', () => {
    const html =
      '<h1>Section 1</h1>' +
      '<p>Content.</p>' +
      '<div data-page-break="true"></div>' +
      '<h2>Section 2</h2>' +
      '<p>Content.</p>' +
      '<div data-page-break="true"></div>' +
      '<h3>Section 3</h3>' +
      '<p>Content.</p>';

    const pages = estimateHeadingPages(html, 1, 3000);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toBe(1);
    expect(pages[1]).toBe(2);
    expect(pages[2]).toBe(3);
  });

  it('accounts for images taking vertical space', () => {
    // An image takes ~1/3 page, so with 2 images + text, headings should shift
    const html =
      '<h1>Title</h1>' +
      '<img src="test.png">' +
      '<img src="test2.png">' +
      '<p>' + 'B'.repeat(2000) + '</p>' +
      '<h2>After Images</h2>' +
      '<p>More text.</p>';

    const pages = estimateHeadingPages(html, 1, 3000);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(1);
    // With 2 images (~2000 chars equivalent) + 2000 chars text, should push to page 2
    expect(pages[1]).toBeGreaterThanOrEqual(2);
  });

  it('uses custom startPage', () => {
    const html = '<h1>Title</h1><p>Content.</p>';
    const pages = estimateHeadingPages(html, 5);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toBe(5);
  });

  it('uses custom charsPerPage for DOCX', () => {
    // With fewer chars per page (DOCX), content should span more pages
    const longParagraph = '<p>' + 'C'.repeat(2000) + '</p>';
    const html =
      '<h1>Chapter 1</h1>' +
      longParagraph +
      '<h2>Chapter 2</h2>' +
      longParagraph;

    const pdfPages = estimateHeadingPages(html, 1, 3000);
    const docxPages = estimateHeadingPages(html, 1, 2200);

    // DOCX should have same or higher page numbers due to fewer chars per page
    expect(docxPages[1]).toBeGreaterThanOrEqual(pdfPages[1]);
  });

  it('handles page-break-node class variant', () => {
    const html =
      '<h1>Before</h1>' +
      '<p>Content.</p>' +
      '<div class="page-break-node"></div>' +
      '<h2>After</h2>';

    const pages = estimateHeadingPages(html, 1, 3000);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(1);
    expect(pages[1]).toBe(2);
  });

  it('handles headings with inline HTML (bold, italic, etc.)', () => {
    const html =
      '<h1><strong>Bold</strong> and <em>italic</em> heading</h1>' +
      '<p>Content.</p>';

    const pages = estimateHeadingPages(html, 1);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toBe(1);
  });
});

describe('extractHeadingsFromHtml', () => {
  it('returns empty array for HTML with no headings', () => {
    expect(extractHeadingsFromHtml('<p>No headings here.</p>')).toEqual([]);
  });

  it('extracts headings with correct levels and text', () => {
    const html =
      '<h1>Title</h1>' +
      '<p>Content</p>' +
      '<h2>Subtitle</h2>' +
      '<h3>Sub-subtitle</h3>';

    const headings = extractHeadingsFromHtml(html);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'Title', id: 'toc-heading-1' });
    expect(headings[1]).toEqual({ level: 2, text: 'Subtitle', id: 'toc-heading-2' });
    expect(headings[2]).toEqual({ level: 3, text: 'Sub-subtitle', id: 'toc-heading-3' });
  });

  it('strips HTML tags from heading text', () => {
    const html = '<h1><strong>Bold</strong> and <em>italic</em></h1>';
    const headings = extractHeadingsFromHtml(html);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe('Bold and italic');
  });

  it('decodes HTML entities in heading text', () => {
    const html = '<h1>Tom &amp; Jerry&rsquo;s Adventure</h1>';
    const headings = extractHeadingsFromHtml(html);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe('Tom & Jerry\u2019s Adventure');
  });

  it('skips headings with empty text', () => {
    const html = '<h1></h1><h2>Real Heading</h2><h3>   </h3>';
    const headings = extractHeadingsFromHtml(html);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[0].id).toBe('toc-heading-1');
  });

  it('assigns sequential IDs', () => {
    const html = '<h1>A</h1><h1>B</h1><h1>C</h1>';
    const headings = extractHeadingsFromHtml(html);
    expect(headings.map((h) => h.id)).toEqual([
      'toc-heading-1',
      'toc-heading-2',
      'toc-heading-3',
    ]);
  });
});

describe('extractTocTitle', () => {
  it('extracts heading text immediately before TOC', () => {
    expect(extractTocTitle('<h1>Table of Contents</h1>')).toBe('Table of Contents');
  });

  it('extracts custom TOC title', () => {
    expect(extractTocTitle('<h2>Document Outline</h2>')).toBe('Document Outline');
  });

  it('extracts the last heading when multiple exist', () => {
    const html = '<h1>Cover Title</h1><p>Some text</p><h2>My TOC</h2>';
    expect(extractTocTitle(html)).toBe('My TOC');
  });

  it('returns empty string when no heading exists', () => {
    expect(extractTocTitle('<p>Just a paragraph</p>')).toBe('');
    expect(extractTocTitle('')).toBe('');
  });

  it('strips inline HTML from heading text', () => {
    expect(extractTocTitle('<h1><strong>Bold</strong> TOC</h1>')).toBe('Bold TOC');
  });

  it('decodes HTML entities', () => {
    expect(extractTocTitle('<h1>Contents &amp; Index</h1>')).toBe('Contents & Index');
  });

  it('handles heading with trailing whitespace before TOC', () => {
    expect(extractTocTitle('<h1>Table of Contents</h1>  ')).toBe('Table of Contents');
  });
});

describe('expandTableOfContents', () => {
  it('returns HTML unchanged when no TOC placeholder exists', () => {
    const html = '<h1>Title</h1><p>Content</p>';
    expect(expandTableOfContents(html)).toBe(html);
  });

  it('returns HTML unchanged for empty input', () => {
    expect(expandTableOfContents('')).toBe('');
  });

  it('expands TOC placeholder with heading entries and user title', () => {
    const html =
      '<h1>Table of Contents</h1>' +
      '<div data-table-of-contents="true"></div>' +
      '<h1>Introduction</h1>' +
      '<p>Content here.</p>' +
      '<h2>Details</h2>' +
      '<p>More content.</p>';

    const result = expandTableOfContents(html);

    // Should contain the TOC wrapper
    expect(result).toContain('class="table-of-contents"');
    // Should contain TOC entries for both headings
    expect(result).toContain('Introduction');
    expect(result).toContain('Details');
    // Should contain data-toc-page attributes for PDF page number injection
    expect(result).toContain('data-toc-page="toc-heading-1"');
    expect(result).toContain('data-toc-page="toc-heading-2"');
    // Should contain the TOC self-entry with the user's title
    expect(result).toContain('data-toc-page="toc-self"');
    expect(result).toContain('Table of Contents');
    // Should inject IDs into headings
    expect(result).toContain('id="toc-heading-1"');
    expect(result).toContain('id="toc-heading-2"');
  });

  it('uses custom user title for TOC self-entry', () => {
    const html =
      '<h2>Document Outline</h2>' +
      '<div data-table-of-contents="true"></div>' +
      '<h1>Introduction</h1>';

    const result = expandTableOfContents(html);
    // Should use the user's custom title
    expect(result).toContain('Document Outline');
    expect(result).toContain('data-toc-page="toc-self"');
  });

  it('omits TOC self-entry when no heading exists before TOC', () => {
    const html =
      '<div data-table-of-contents="true"></div>' +
      '<h1>Introduction</h1>' +
      '<p>Content here.</p>';

    const result = expandTableOfContents(html);
    // Should NOT contain a toc-self entry since there's no heading before the TOC
    expect(result).not.toContain('data-toc-page="toc-self"');
    // But should still contain content heading entries
    expect(result).toContain('data-toc-page="toc-heading-1"');
  });

  it('estimates TOC page based on content before it', () => {
    // When there's a page break before the TOC, the TOC should be on page 2+
    // The heading "Table of Contents" is placed right before the TOC block
    const html =
      '<h1>Cover Page Title</h1>' +
      '<p>Cover page content.</p>' +
      '<div data-page-break="true"></div>' +
      '<h1>Table of Contents</h1>' +
      '<div data-table-of-contents="true"></div>' +
      '<h1>Introduction</h1>' +
      '<p>Content here.</p>';

    const result = expandTableOfContents(html);

    // The TOC self-entry should use the user's title and reference page 2+
    expect(result).toContain('data-toc-page="toc-self"');
    expect(result).toContain('Table of Contents');
    // Content headings should start after the TOC
    expect(result).toContain('data-toc-page="toc-heading-1"');
  });

  it('shows "No headings found" when no headings exist after TOC', () => {
    const html =
      '<div data-table-of-contents="true"></div>' +
      '<p>Just paragraphs, no headings.</p>';

    const result = expandTableOfContents(html);
    expect(result).toContain('No headings found');
  });

  it('handles TOC placeholder with existing class attribute', () => {
    const html =
      '<div class="table-of-contents" data-table-of-contents="true"></div>' +
      '<h1>Title</h1>';

    const result = expandTableOfContents(html);
    expect(result).toContain('data-toc-page="toc-heading-1"');
  });

  it('handles TOC placeholder with inner content (older saves)', () => {
    const html =
      '<div data-table-of-contents="true" class="table-of-contents"><p>Old TOC content</p></div>' +
      '<h1>Title</h1>';

    const result = expandTableOfContents(html);
    // Old content should be replaced
    expect(result).not.toContain('Old TOC content');
    expect(result).toContain('data-toc-page="toc-heading-1"');
  });

  it('does not add id to headings that already have one', () => {
    const html =
      '<div data-table-of-contents="true"></div>' +
      '<h1 id="existing-id">Title</h1>';

    const result = expandTableOfContents(html);
    // Should keep the existing id
    expect(result).toContain('id="existing-id"');
    // Should NOT inject a new id
    expect(result).not.toContain('id="toc-heading-1"');
  });

  it('preserves content before the TOC placeholder', () => {
    const html =
      '<p>Before TOC</p>' +
      '<div data-table-of-contents="true"></div>' +
      '<h1>Title</h1>';

    const result = expandTableOfContents(html);
    expect(result).toContain('<p>Before TOC</p>');
  });

  it('includes dot leader spans for page numbers', () => {
    const html =
      '<div data-table-of-contents="true"></div>' +
      '<h1>Title</h1>';

    const result = expandTableOfContents(html);
    // Should have dot leader styling
    expect(result).toContain('border-bottom:1px dotted');
  });

  it('applies correct indentation for nested heading levels', () => {
    const html =
      '<div data-table-of-contents="true"></div>' +
      '<h1>Level 1</h1>' +
      '<h2>Level 2</h2>' +
      '<h3>Level 3</h3>';

    const result = expandTableOfContents(html);
    // Level 1 (min level) should have 0px indent
    expect(result).toContain('padding-left:0px');
    // Level 2 should have 16px indent
    expect(result).toContain('padding-left:16px');
    // Level 3 should have 32px indent
    expect(result).toContain('padding-left:32px');
  });
});
