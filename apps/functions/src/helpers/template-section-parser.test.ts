import {
  parseTemplateSections,
  templateHasStructure,
  extractTemplatePreamble,
  extractTemplatePostamble,
  injectSectionsIntoTemplate,
  injectContentIntoSimpleTemplate,
} from './template-section-parser';

// ─── parseTemplateSections ────────────────────────────────────────────────────

describe('parseTemplateSections', () => {
  it('returns null for empty input', () => {
    expect(parseTemplateSections('')).toBeNull();
    expect(parseTemplateSections('  ')).toBeNull();
  });

  it('returns null for template without headings', () => {
    const html = '<p>Just some text</p><div>No headings here</div>';
    expect(parseTemplateSections(html)).toBeNull();
  });

  it('extracts h2 sections with titles', () => {
    const html = `
      <h1>Document Title</h1>
      <h2>Section One</h2>
      <p>Content for section one</p>
      <h2>Section Two</h2>
      <p>Content for section two</p>
    `;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0].title).toBe('Section One');
    expect(sections![1].title).toBe('Section Two');
  });

  it('captures h3 as description for the current section', () => {
    const html = `
      <h2>Main Section</h2>
      <h3>Subsection Detail</h3>
      <p>Some content</p>
    `;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(1);
    expect(sections![0].title).toBe('Main Section');
    expect(sections![0].description).toBe('Subsection Detail');
  });

  it('concatenates multiple h3 descriptions', () => {
    const html = `
      <h2>Main Section</h2>
      <h3>First Detail</h3>
      <h3>Second Detail</h3>
      <p>Content</p>
    `;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections![0].description).toBe('First Detail. Second Detail');
  });

  it('captures templateContent between sections', () => {
    const html = `<h2>Section A</h2><p>Content A</p><h2>Section B</h2><p>Content B</p>`;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0].templateContent).toContain('Content A');
    expect(sections![1].templateContent).toContain('Content B');
  });

  it('strips HTML tags and macros from heading text', () => {
    const html = `<h2 style="color:red"><strong>{{MACRO}}</strong> Real Title [placeholder]</h2><p>Content</p>`;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections![0].title).toBe('Real Title');
  });

  it('skips empty headings after stripping', () => {
    const html = `<h2>{{MACRO}}</h2><h2>Valid Section</h2><p>Content</p>`;
    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(1);
    expect(sections![0].title).toBe('Valid Section');
  });
});

// ─── templateHasStructure ─────────────────────────────────────────────────────

describe('templateHasStructure', () => {
  it('returns false for empty input', () => {
    expect(templateHasStructure('')).toBe(false);
    expect(templateHasStructure('  ')).toBe(false);
  });

  it('returns false for template without h2/h3', () => {
    expect(templateHasStructure('<h1>Title</h1><p>Content</p>')).toBe(false);
  });

  it('returns true for template with h2', () => {
    expect(templateHasStructure('<h2>Section</h2>')).toBe(true);
  });

  it('returns true for template with h3', () => {
    expect(templateHasStructure('<h3>Subsection</h3>')).toBe(true);
  });
});

// ─── extractTemplatePreamble ──────────────────────────────────────────────────

describe('extractTemplatePreamble', () => {
  it('returns empty string for empty input', () => {
    expect(extractTemplatePreamble('')).toBe('');
    expect(extractTemplatePreamble('  ')).toBe('');
  });

  it('returns empty string when no h2 found', () => {
    expect(extractTemplatePreamble('<p>No headings</p>')).toBe('');
  });

  it('extracts everything before the first h2', () => {
    const html = `<!-- SCAFFOLD -->
<h1 style="font-size:2em">Document Title</h1>
<p>Introduction text</p>
<img src="s3key:logo.png" />
<h2>First Section</h2>
<p>Section content</p>`;

    const preamble = extractTemplatePreamble(html);
    expect(preamble).toContain('<!-- SCAFFOLD -->');
    expect(preamble).toContain('<h1');
    expect(preamble).toContain('Document Title');
    expect(preamble).toContain('Introduction text');
    expect(preamble).toContain('<img src="s3key:logo.png"');
    expect(preamble).not.toContain('First Section');
    expect(preamble).not.toContain('Section content');
  });

  it('handles h2 with attributes', () => {
    const html = `<p>Preamble</p><h2 style="color:red">Section</h2>`;
    const preamble = extractTemplatePreamble(html);
    expect(preamble).toBe('<p>Preamble</p>');
  });
});

// ─── extractTemplatePostamble ─────────────────────────────────────────────────

describe('extractTemplatePostamble', () => {
  it('returns empty string for empty input', () => {
    expect(extractTemplatePostamble('')).toBe('');
  });

  it('returns empty string when no h2 found', () => {
    expect(extractTemplatePostamble('<p>No headings</p>')).toBe('');
  });

  it('returns empty string when no footer marker exists', () => {
    const html = `<h2>Section</h2><p>Content</p>`;
    expect(extractTemplatePostamble(html)).toBe('');
  });

  it('extracts content after <!-- FOOTER --> marker', () => {
    const html = `<h2>Section</h2><p>Content</p><!-- FOOTER --><p>Footer text</p>`;
    const postamble = extractTemplatePostamble(html);
    expect(postamble).toContain('<!-- FOOTER -->');
    expect(postamble).toContain('Footer text');
  });

  it('extracts content after <hr> marker', () => {
    const html = `<h2>Section</h2><p>Content</p><hr/><p>Closing statement</p>`;
    const postamble = extractTemplatePostamble(html);
    expect(postamble).toContain('<hr/>');
    expect(postamble).toContain('Closing statement');
  });

  it('extracts content after <!-- END OF CONTENT --> marker', () => {
    const html = `<h2>Section</h2><p>Content</p><!-- END OF CONTENT --><p>Copyright 2026</p>`;
    const postamble = extractTemplatePostamble(html);
    expect(postamble).toContain('Copyright 2026');
  });

  it('extracts content after <footer> tag', () => {
    const html = `<h2>Section</h2><p>Content</p><footer><p>Page 1</p></footer>`;
    const postamble = extractTemplatePostamble(html);
    expect(postamble).toContain('<footer>');
    expect(postamble).toContain('Page 1');
  });
});

// ─── injectSectionsIntoTemplate ───────────────────────────────────────────────

describe('injectSectionsIntoTemplate', () => {
  it('returns joined fragments when template is empty', () => {
    const fragments = ['<h2>A</h2><p>Content A</p>', '<h2>B</h2><p>Content B</p>'];
    const result = injectSectionsIntoTemplate('', fragments);
    expect(result).toContain('Content A');
    expect(result).toContain('Content B');
  });

  it('returns empty string when no fragments provided', () => {
    const result = injectSectionsIntoTemplate('<h2>Section</h2>', []);
    expect(result).toBe('');
  });

  it('preserves template preamble with generated sections', () => {
    const template = `<!-- SCAFFOLD -->
<h1 style="font-size:2em">Cover Letter</h1>
<p>Date: March 6, 2026</p>
<img src="s3key:company-logo.png" />
<h2>Opening</h2>
<p>[CONTENT: Write opening paragraph]</p>
<h2>Qualifications</h2>
<p>[CONTENT: Write qualifications]</p>`;

    const fragments = [
      '<h2>Opening</h2><p>Dear Contracting Officer, we are pleased to submit...</p>',
      '<h2>Qualifications</h2><p>Our team has 20 years of experience...</p>',
    ];

    const result = injectSectionsIntoTemplate(template, fragments);

    // Preamble should be preserved
    expect(result).toContain('<!-- SCAFFOLD -->');
    expect(result).toContain('Cover Letter');
    expect(result).toContain('Date: March 6, 2026');
    expect(result).toContain('s3key:company-logo.png');

    // Generated content should be present
    expect(result).toContain('Dear Contracting Officer');
    expect(result).toContain('20 years of experience');
  });

  it('preserves template postamble (footer)', () => {
    const template = `<h1>Title</h1>
<h2>Section</h2>
<p>[CONTENT: ...]</p>
<!-- FOOTER -->
<p>Copyright 2026 Acme Corp</p>`;

    const fragments = ['<h2>Section</h2><p>Generated content here</p>'];

    const result = injectSectionsIntoTemplate(template, fragments);

    // Preamble
    expect(result).toContain('<h1>Title</h1>');

    // Generated content
    expect(result).toContain('Generated content here');

    // Postamble
    expect(result).toContain('Copyright 2026 Acme Corp');
  });

  it('handles template with no preamble (starts with h2)', () => {
    const template = `<h2>Section One</h2><p>Placeholder</p>`;
    const fragments = ['<h2>Section One</h2><p>Real content</p>'];

    const result = injectSectionsIntoTemplate(template, fragments);
    expect(result).toContain('Real content');
  });
});

// ─── injectContentIntoSimpleTemplate ──────────────────────────────────────────

describe('injectContentIntoSimpleTemplate', () => {
  it('returns generated HTML when template is empty', () => {
    const result = injectContentIntoSimpleTemplate('', '<p>Generated</p>');
    expect(result).toBe('<p>Generated</p>');
  });

  it('returns template when generated HTML is empty', () => {
    const result = injectContentIntoSimpleTemplate('<p>Template</p>', '');
    expect(result).toBe('<p>Template</p>');
  });

  it('replaces [CONTENT: ...] placeholder with generated content', () => {
    const template = `<h1>Title</h1>
<p>Date: March 6, 2026</p>
[CONTENT: Write the document content here]
<p>Footer text</p>`;

    const generated = '<h2>Section</h2><p>AI generated content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).not.toBeNull();
    expect(result).toContain('<h1>Title</h1>');
    expect(result).toContain('Date: March 6, 2026');
    expect(result).toContain('AI generated content');
    expect(result).toContain('Footer text');
    expect(result).not.toContain('[CONTENT:');
  });

  it('replaces [CONTENT: ...] inside a <p> tag', () => {
    const template = `<h1>Title</h1>
<p style="margin:0">[CONTENT: Write content here based on solicitation]</p>`;

    const generated = '<p>Real content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).not.toBeNull();
    expect(result).toContain('Real content');
    expect(result).not.toContain('[CONTENT:');
  });

  it('replaces only the first [CONTENT: ...] placeholder (single insertion point)', () => {
    const template = `<h1>Title</h1>
[CONTENT: First section]
<p>Separator</p>
[CONTENT: Second section]`;

    const generated = '<p>Generated text</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).not.toBeNull();
    // Only the first placeholder is replaced — templates should have a single {{CONTENT}} variable
    expect(result).toContain('Generated text');
    // The second placeholder remains (worker strips remaining placeholders as a safety net)
    expect(result).toContain('[CONTENT: Second section]');
  });

  it('returns null when template has no {{CONTENT}} placeholder', () => {
    const template = `<h1 style="font-size:2em">Document Title</h1>
<p>Some boilerplate without a content variable</p>`;

    const generated = '<p>AI generated content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).toBeNull();
  });

  it('returns null when template has no placeholder and no h1', () => {
    const template = '<div>Template wrapper without content variable</div>';
    const generated = '<p>Generated content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).toBeNull();
  });

  it('preserves images and resolved macros in template', () => {
    const template = `<h1>Cover Letter</h1>
<img src="s3key:logos/company.png" data-s3-key="logos/company.png" />
<p>Date: March 6, 2026</p>
<p>Company: Acme Corporation</p>
[CONTENT: Write the cover letter content]
<p>Sincerely,</p>
<p>John Doe, CEO</p>`;

    const generated = '<p>Dear Sir/Madam, we are pleased to submit our proposal...</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).not.toBeNull();

    // Template elements preserved
    expect(result).toContain('s3key:logos/company.png');
    expect(result).toContain('March 6, 2026');
    expect(result).toContain('Acme Corporation');
    expect(result).toContain('Sincerely,');
    expect(result).toContain('John Doe, CEO');

    // Generated content injected
    expect(result).toContain('we are pleased to submit our proposal');

    // No content added outside the placeholder
    expect(result).not.toContain('[CONTENT:');
  });

  it('does not add content outside the designated placeholder area', () => {
    const template = `<h1>Cover Letter</h1>
<p>Date: March 6, 2026</p>
[CONTENT: Write the cover letter content here]
<p>Sincerely, John Doe</p>`;

    const generated = '<p>We are pleased to submit our proposal.</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);

    expect(result).not.toBeNull();

    // Verify the generated content appears exactly where the placeholder was
    const lines = result!.split('\n');
    const dateLineIdx = lines.findIndex(l => l.includes('March 6, 2026'));
    const generatedLineIdx = lines.findIndex(l => l.includes('We are pleased'));
    const signatureLineIdx = lines.findIndex(l => l.includes('Sincerely'));

    // Generated content should be between the date and signature
    expect(generatedLineIdx).toBeGreaterThan(dateLineIdx);
    expect(generatedLineIdx).toBeLessThan(signatureLineIdx);
  });
});
