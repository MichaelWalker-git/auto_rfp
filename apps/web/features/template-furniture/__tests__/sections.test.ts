import { countFurnitureSections, deriveFurnitureSections } from '../lib/sections';

describe('deriveFurnitureSections', () => {
  it('treats content with no page breaks as one section', () => {
    const sections = deriveFurnitureSections('<p>Only content</p>');
    expect(sections).toHaveLength(1);
    expect(sections[0].index).toBe(0);
  });

  it('splits on the TipTap page-break node', () => {
    const html = '<h1>Cover</h1><div data-page-break="true"></div><h1>Body</h1>';
    expect(deriveFurnitureSections(html)).toHaveLength(2);
  });

  it('splits on the legacy page-break class', () => {
    const html = '<p>A</p><div class="page-break-node"></div><p>B</p>';
    expect(deriveFurnitureSections(html)).toHaveLength(2);
  });

  it('labels a section with its first heading', () => {
    const html = '<h1>Cover Letter</h1><p>body</p><div data-page-break="true"></div><h2>Appendix A</h2>';
    const sections = deriveFurnitureSections(html);
    expect(sections[0].label).toBe('Cover Letter');
    expect(sections[1].label).toBe('Appendix A');
  });

  it('falls back to body text when a section has no heading', () => {
    const sections = deriveFurnitureSections('<p>Just some prose</p>');
    expect(sections[0].label).toBe('Just some prose');
  });

  it('falls back to a positional label for an empty section', () => {
    const html = '<div data-page-break="true"></div><p>Body</p>';
    expect(deriveFurnitureSections(html)[0].label).toBe('Section 1');
  });

  it('truncates a long label', () => {
    const long = 'x'.repeat(80);
    const label = deriveFurnitureSections(`<p>${long}</p>`)[0].label;
    expect(label.length).toBeLessThanOrEqual(41);
    expect(label.endsWith('…')).toBe(true);
  });

  it('decodes entities and collapses whitespace in labels', () => {
    const sections = deriveFurnitureSections('<h1>Terms &amp;   Conditions</h1>');
    expect(sections[0].label).toBe('Terms & Conditions');
  });

  it('handles empty input without throwing', () => {
    expect(deriveFurnitureSections('')).toHaveLength(1);
  });

  it('produces cover / body / appendix for the ticket scenario', () => {
    const html = [
      '<h1>Cover</h1>',
      '<div data-page-break="true"></div>',
      '<h1>Technical Approach</h1>',
      '<div data-page-break="true"></div>',
      '<h1>Appendix</h1>',
    ].join('');
    expect(countFurnitureSections(html)).toBe(3);
  });
});
