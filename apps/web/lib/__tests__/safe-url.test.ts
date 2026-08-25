import { safeExternalUrl } from '../safe-url';

/**
 * These are the payloads the guard exists to stop. Each one is accepted by
 * `z.string().url()` (verified against the installed zod 3.25), so schema validation
 * alone leaves them in the DOM.
 */
describe('safeExternalUrl', () => {
  it('allows http and https', () => {
    expect(safeExternalUrl('https://foia.agency.gov/request')).toBe('https://foia.agency.gov/request');
    expect(safeExternalUrl('http://records.example.gov')).toBe('http://records.example.gov');
  });

  it('rejects javascript: in any casing', () => {
    expect(safeExternalUrl('javascript:alert(document.cookie)')).toBeNull();
    expect(safeExternalUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeExternalUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  /**
   * Browsers strip leading control characters before resolving a URL, so a regex anchored
   * at the start of the raw string can be walked straight past. Parsing with `URL`
   * normalises them first.
   */
  it('rejects javascript: hidden behind leading whitespace or control characters', () => {
    expect(safeExternalUrl('  javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('\njavascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('\tjavascript:alert(1)')).toBeNull();
  });

  it('rejects other executable or embedding schemes', () => {
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
  });

  /** Excluded deliberately: this guard is for link targets, not mail or dial actions. */
  it('rejects mailto: and tel:', () => {
    expect(safeExternalUrl('mailto:foia@agency.gov')).toBeNull();
    expect(safeExternalUrl('tel:+15551234567')).toBeNull();
  });

  it('returns null for absent or blank values', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
  });

  it('returns the original string unmodified, so display and navigation agree', () => {
    const url = 'https://agency.gov/foia?id=1&x=2#frag';
    expect(safeExternalUrl(url)).toBe(url);
  });
});
