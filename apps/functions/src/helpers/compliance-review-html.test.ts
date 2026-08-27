import { extractHeadings, getSectionText, splitIntoSections, stripHtml } from './compliance-review-html';

const HTML = `
  <h1>Cover Letter</h1>
  <p>Dear Sir or Madam,</p>
  <h2>3.1 Technical Approach</h2>
  <p>Our approach uses <strong>agile</strong> methods &amp; tooling.</p>
  <h2>3.2 Management Plan</h2>
  <p>We staff a dedicated PM.</p>
`;

describe('stripHtml', () => {
  it('strips tags and decodes entities', () => {
    expect(stripHtml('<p>agile &amp; <strong>lean</strong></p>')).toBe('agile & lean');
  });

  it('converts <br> to newlines', () => {
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });
});

describe('extractHeadings', () => {
  it('returns headings in order', () => {
    expect(extractHeadings(HTML)).toEqual(['Cover Letter', '3.1 Technical Approach', '3.2 Management Plan']);
  });

  it('returns empty array when no headings', () => {
    expect(extractHeadings('<p>no headings here</p>')).toEqual([]);
  });
});

describe('getSectionText', () => {
  it('returns text under the matching heading up to the next heading', () => {
    const text = getSectionText(HTML, '3.1 Technical Approach', 1000);
    expect(text).toContain('Our approach uses agile methods & tooling.');
    expect(text).not.toContain('We staff a dedicated PM.');
  });

  it('is case-insensitive on the heading match', () => {
    const text = getSectionText(HTML, '3.1 technical approach', 1000);
    expect(text).toContain('Our approach');
  });

  it('truncates to maxChars', () => {
    const text = getSectionText(HTML, '3.1 Technical Approach', 5);
    expect(text.length).toBeLessThanOrEqual(5);
  });

  it('falls back to whole-document text when heading not found', () => {
    const text = getSectionText(HTML, 'Nonexistent', 1000);
    expect(text).toContain('Cover Letter');
  });

  it('includes subsection content under a parent heading (regression: labor rate schedule)', () => {
    // A parent section (h2) whose body lives entirely under a child (h3) must
    // NOT return empty — it should swallow the child and its content.
    const nested = `
      <h2>3. Labor Rate Schedule</h2>
      <h3>3.1 Proposed Labor Categories and Fully Burdened Rates</h3>
      <p>Rates are fully burdened and include direct labor, fringe, overhead, G&amp;A, and profit.</p>
      <h2>4. Other Direct Costs</h2>
      <p>ODCs are billed at cost.</p>
    `;
    const text = getSectionText(nested, '3. Labor Rate Schedule', 2000);
    expect(text).toContain('3.1 Proposed Labor Categories');
    expect(text).toContain('Rates are fully burdened');
    // Must stop at the next same-level heading.
    expect(text).not.toContain('ODCs are billed at cost');
  });

  it('a child subsection returns only its own content', () => {
    const nested = `
      <h2>3. Labor Rate Schedule</h2>
      <h3>3.1 Rates</h3>
      <p>child content</p>
      <h3>3.2 Escalation</h3>
      <p>escalation content</p>
    `;
    const text = getSectionText(nested, '3.1 Rates', 2000);
    expect(text).toContain('child content');
    expect(text).not.toContain('escalation content');
  });
});

describe('splitIntoSections (non-overlapping — used by scanners)', () => {
  it('gives each heading ONLY its own body, never a child subsection', () => {
    const html =
      '<h2>4. Contract #3</h2><p>intro alpha</p>' +
      '<h3>4.2 Relevance</h3><p>relevance beta</p>' +
      '<h3>4.3 Approach</h3><p>approach gamma</p>';
    const sections = splitIntoSections(html);
    expect(sections.map((s) => s.heading)).toEqual(['4. Contract #3', '4.2 Relevance', '4.3 Approach']);
    expect(sections[0].text).toContain('intro alpha');
    expect(sections[0].text).not.toContain('relevance beta');
    expect(sections[0].text).not.toContain('approach gamma');
  });

  it('a word occurring once under a nested heading appears in exactly ONE segment (dup regression)', () => {
    // Previously getSectionText let the parent swallow the child, so "Ricoh"
    // matched under both "Past Performance Volume" and "4.2 Relevance",
    // producing two NDA-leak findings for one occurrence.
    const html =
      '<h2>Past Performance Volume</h2><p>overview</p>' +
      '<h3>4.2 Relevance to Current Opportunity</h3><p>This contract with Ricoh was great.</p>';
    const hits = splitIntoSections(html).filter((s) => s.text.includes('Ricoh'));
    expect(hits).toHaveLength(1);
    expect(hits[0].heading).toBe('4.2 Relevance to Current Opportunity');
  });

  it('captures preamble before the first heading with an empty heading', () => {
    const sections = splitIntoSections('<p>before anything</p><h2>Section A</h2><p>body</p>');
    expect(sections[0]).toEqual({ heading: '', text: 'before anything' });
    expect(sections[1].heading).toBe('Section A');
  });

  it('returns a single empty-heading segment for a heading-less document', () => {
    const sections = splitIntoSections('<p>just prose here</p>');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('');
    expect(sections[0].text).toContain('just prose here');
  });
});
