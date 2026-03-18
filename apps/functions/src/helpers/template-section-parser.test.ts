import {
  parseTemplateSections,
  templateHasStructure,
  injectSectionsIntoTemplate,
  injectContentIntoSimpleTemplate,
} from './template-section-parser';

// ─── parseTemplateSections ────────────────────────────────────────────────────

describe('parseTemplateSections', () => {
  it('returns null for empty input', () => {
    expect(parseTemplateSections('')).toBeNull();
    expect(parseTemplateSections('   ')).toBeNull();
  });

  it('returns null for template without h2 headings', () => {
    const html = `
      <h1>Document Title</h1>
      <p>Some content here</p>
      <p>[CONTENT: Write content here]</p>
    `;
    expect(parseTemplateSections(html)).toBeNull();
  });

  it('parses a template with multiple h2 sections', () => {
    const html = `
      <h1>Technical Proposal</h1>
      <p>Introduction text</p>
      <h2>Executive Summary</h2>
      <p>[CONTENT: Write executive summary]</p>
      <h2>Technical Approach</h2>
      <p>[CONTENT: Write technical approach]</p>
      <h2>Management Plan</h2>
      <p>[CONTENT: Write management plan]</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(3);
    expect(sections![0]!.title).toBe('Executive Summary');
    expect(sections![1]!.title).toBe('Technical Approach');
    expect(sections![2]!.title).toBe('Management Plan');
  });

  it('extracts h3 headings as descriptions', () => {
    const html = `
      <h2>Risk Management</h2>
      <h3>Risk Identification Process</h3>
      <p>Content about risk identification</p>
      <h3>Mitigation Strategies</h3>
      <p>Content about mitigation</p>
      <h2>Quality Assurance</h2>
      <p>QA content</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0]!.title).toBe('Risk Management');
    expect(sections![0]!.description).toBe('Risk Identification Process. Mitigation Strategies');
    expect(sections![1]!.title).toBe('Quality Assurance');
    expect(sections![1]!.description).toBeUndefined();
  });

  it('preserves template content between sections', () => {
    const html = `
      <h2>Section One</h2>
      <p>Boilerplate text for section one</p>
      <img src="s3key:logo.png" />
      <h2>Section Two</h2>
      <p>[CONTENT: Write section two]</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections![0]!.templateContent).toContain('Boilerplate text for section one');
    expect(sections![0]!.templateContent).toContain('s3key:logo.png');
  });

  it('handles h2 headings with inline styles', () => {
    const html = `
      <h2 style="font-size:1.4em;font-weight:700">Executive Summary</h2>
      <p>Content</p>
      <h2 class="section-heading" style="color:blue">Technical Approach</h2>
      <p>More content</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0]!.title).toBe('Executive Summary');
    expect(sections![1]!.title).toBe('Technical Approach');
  });

  it('skips empty h2 headings', () => {
    const html = `
      <h2></h2>
      <p>Content for empty heading</p>
      <h2>Real Section</h2>
      <p>Real content</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(1);
    expect(sections![0]!.title).toBe('Real Section');
  });

  it('strips HTML tags and macros from heading text', () => {
    const html = `
      <h2><strong>Bold</strong> Section {{COMPANY_NAME}}</h2>
      <p>Content</p>
      <h2>Section with [placeholder] text</h2>
      <p>More content</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0]!.title).toBe('Bold Section');
    expect(sections![1]!.title).toBe('Section with text');
  });

  it('handles single h2 section', () => {
    const html = `
      <h1>Title</h1>
      <h2>Only Section</h2>
      <p>Content</p>
    `;

    const sections = parseTemplateSections(html);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(1);
    expect(sections![0]!.title).toBe('Only Section');
  });
});

// ─── templateHasStructure ─────────────────────────────────────────────────────

describe('templateHasStructure', () => {
  it('returns false for empty input', () => {
    expect(templateHasStructure('')).toBe(false);
    expect(templateHasStructure('   ')).toBe(false);
  });

  it('returns false for template without h2/h3', () => {
    expect(templateHasStructure('<h1>Title</h1><p>Content</p>')).toBe(false);
  });

  it('returns true for template with h2', () => {
    expect(templateHasStructure('<h2>Section</h2><p>Content</p>')).toBe(true);
  });

  it('returns true for template with h2 with attributes', () => {
    expect(templateHasStructure('<h2 style="color:red">Section</h2>')).toBe(true);
  });
});

// ─── injectSectionsIntoTemplate ───────────────────────────────────────────────

describe('injectSectionsIntoTemplate', () => {
  it('returns joined fragments when template is empty', () => {
    const fragments = ['<h2>Section 1</h2><p>Content 1</p>', '<h2>Section 2</h2><p>Content 2</p>'];
    const result = injectSectionsIntoTemplate('', fragments);
    expect(result).toContain('Section 1');
    expect(result).toContain('Section 2');
  });

  it('joins section fragments with double newlines', () => {
    const template = `<h1>Document Title</h1>
<p>Intro text</p>
<h2>Section A</h2>
<p>[CONTENT: placeholder]</p>
<h2>Section B</h2>
<p>[CONTENT: placeholder]</p>`;

    const fragments = [
      '<h2>Section A</h2><p>Generated content A</p>',
      '<h2>Section B</h2><p>Generated content B</p>',
    ];

    const result = injectSectionsIntoTemplate(template, fragments);
    expect(result).toContain('Generated content A');
    expect(result).toContain('Generated content B');
    expect(result).toBe(fragments.join('\n\n'));
  });
});

// ─── injectContentIntoSimpleTemplate ──────────────────────────────────────────

describe('injectContentIntoSimpleTemplate', () => {
  it('returns generated HTML when template is empty', () => {
    expect(injectContentIntoSimpleTemplate('', '<p>Generated</p>')).toBe('<p>Generated</p>');
  });

  it('returns template when generated HTML is empty', () => {
    expect(injectContentIntoSimpleTemplate('<p>Template</p>', '')).toBe('<p>Template</p>');
  });

  it('replaces [CONTENT: ...] placeholder', () => {
    const template = '<h1>Title</h1>\n[CONTENT: Write content here]\n<p>Footer</p>';
    const generated = '<p>Generated content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);
    expect(result).toContain('Title');
    expect(result).toContain('Generated content');
    expect(result).toContain('Footer');
    expect(result).not.toContain('[CONTENT:');
  });

  it('replaces <p> wrapped [CONTENT: ...] placeholder', () => {
    const template = '<h1>Title</h1>\n<p style="margin:0">[CONTENT: Write content]</p>\n<p>Footer</p>';
    const generated = '<h2>Section</h2><p>Generated content</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);
    expect(result).toContain('Title');
    expect(result).toContain('Generated content');
    expect(result).not.toContain('[CONTENT:');
  });

  it('returns null when no placeholder found', () => {
    const template = '<h1>Title</h1>\n<p>No placeholder here</p>';
    const generated = '<p>Generated content</p>';
    expect(injectContentIntoSimpleTemplate(template, generated)).toBeNull();
  });

  it('replaces only the first occurrence', () => {
    const template = '[CONTENT: First]\n[CONTENT: Second]';
    const generated = '<p>Replaced</p>';
    const result = injectContentIntoSimpleTemplate(template, generated);
    expect(result).toContain('<p>Replaced</p>');
    expect(result).toContain('[CONTENT: Second]');
  });
});
