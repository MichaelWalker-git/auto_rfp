import { TemplateFurnitureSchema, type TemplateFurniture } from '@auto-rfp/core';
import { buildExportHtml } from './export-html-builder';

const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
  TemplateFurnitureSchema.parse({
    header: { html: '<p>ACME Corp</p>' },
    footer: { html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' },
    ...over,
  });

describe('buildExportHtml — without furniture', () => {
  it('keeps the original 1in margin box, so existing exports are unchanged', () => {
    const html = buildExportHtml('<p>Body</p>');
    // Regression guard for every pre-existing template.
    expect(html).toContain('margin: 1in 1in 1in 1in;');
    // The furniture CSS classes are always present in the stylesheet; what must be
    // absent is any rendered band element.
    expect(html).not.toContain('<div class="export-furniture');
  });

  it('passes the body through untagged', () => {
    const html = buildExportHtml('<p>Body</p>');
    expect(html).toContain('<body><p>Body</p></body>');
    expect(html).not.toContain('data-furniture-section');
  });

  it('still honours page size', () => {
    expect(buildExportHtml('<p>x</p>', { pageSize: 'a4' })).toContain('size: 210mm 297mm');
  });
});

describe('buildExportHtml — with furniture', () => {
  it('grows both margins to reserve the furniture bands', () => {
    const html = buildExportHtml('<p>Body</p>', { furniture: furniture() });
    // 1in base + 0.5in header, 1in base + 0.5in footer.
    expect(html).toContain('margin: 1.5in 1in 1.5in 1in;');
  });

  it('grows only the top margin when the footer is empty', () => {
    const f = furniture({ footer: { enabled: true, html: '', align: 'CENTER', heightIn: 0.5 } });
    const html = buildExportHtml('<p>Body</p>', { furniture: f });
    expect(html).toContain('margin: 1.5in 1in 1in 1in;');
  });

  it('renders an on-screen header/footer band', () => {
    const html = buildExportHtml('<p>Body</p>', { furniture: furniture() });
    expect(html).toContain('export-furniture--header');
    expect(html).toContain('export-furniture--footer');
    expect(html).toContain('ACME Corp');
  });

  it('hides the band in print so PDF furniture is not duplicated', () => {
    const html = buildExportHtml('<p>Body</p>', { furniture: furniture() });
    expect(html).toMatch(/@media print\s*\{\s*\.export-furniture\s*\{\s*display:\s*none;/);
  });

  it('shows literal 1 for page tokens, since a scrolling page has no page number', () => {
    const html = buildExportHtml('<p>Body</p>', { furniture: furniture() });
    expect(html).toContain('Page 1 of 1');
    expect(html).not.toContain('{{PAGE_NUMBER}}');
  });

  it('applies alignment to the band', () => {
    const f = furniture({ header: { enabled: true, html: '<p>H</p>', align: 'RIGHT', heightIn: 0.5 } });
    expect(buildExportHtml('<p>x</p>', { furniture: f })).toContain('text-align: right');
  });

  it('emits no furniture markup when content is blank', () => {
    // Enabled-but-empty furniture must not reserve margin space or render a band,
    // otherwise the body is pushed down for no visible reason.
    const f = TemplateFurnitureSchema.parse({});
    const html = buildExportHtml('<p>Body</p>', { furniture: f });
    expect(html).not.toContain('<div class="export-furniture');
    expect(html).toContain('margin: 1in 1in 1in 1in;');
  });
});

describe('buildExportHtml — per-section overrides', () => {
  const body = '<p>Cover</p><div data-page-break="true"></div><p>Body</p><div data-page-break="true"></div><p>Appendix</p>';

  it('tags each page-break section so the PDF renderer can measure it', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const html = buildExportHtml(body, { furniture: f });
    expect(html).toContain('data-furniture-section="0"');
    expect(html).toContain('data-furniture-section="1"');
    expect(html).toContain('data-furniture-section="2"');
  });

  it('re-emits a page break between sections after splitting consumed them', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const html = buildExportHtml(body, { furniture: f });
    // Two breaks for three sections — losing these would merge the cover into the body.
    expect(html.match(/data-page-break="true"/g)).toHaveLength(2);
  });

  it('emits no named-page CSS, which cannot override headerTemplate anyway', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const html = buildExportHtml(body, { furniture: f });
    // Measured against Chromium: these rules had zero effect on the rendered
    // furniture, and assigning a named page forced a spurious extra page.
    expect(html).not.toContain('@page furniture-');
    expect(html).not.toContain('page: furniture-');
  });

  it('uses zero-height markers so tagging cannot shift pagination', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const html = buildExportHtml(body, { furniture: f });
    expect(html).toMatch(/<span data-furniture-section="0"[^>]*height:0/);
  });

  it('does not tag sections when no override suppresses anything', () => {
    const html = buildExportHtml(body, { furniture: furniture() });
    expect(html).not.toContain('data-furniture-section');
  });

  it('wraps single-section content when an override exists but no breaks do', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const html = buildExportHtml('<p>Only</p>', { furniture: f });
    expect(html).toContain('data-furniture-section="0"');
  });
});
