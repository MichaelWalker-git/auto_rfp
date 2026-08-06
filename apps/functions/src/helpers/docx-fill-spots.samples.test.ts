import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { findDocxFillSpots, injectFieldMarkers, FIELD_MARKER_OPEN, FIELD_MARKER_CLOSE } from './docx-fill-spots';

const dir = join(__dirname, '../../../../docs/example-docs');
const load = async (name: string): Promise<string | null> => {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  const zip = await JSZip.loadAsync(readFileSync(p));
  return (await zip.file('word/document.xml')?.async('string')) ?? null;
};

// End-to-end round-trip against the real samples (gitignored → skips in CI):
// find spots → splice a value into ONE spot → re-find and confirm the value
// landed where the finder said, WITHOUT shifting the other spots' identity.
describe('findDocxFillSpots round-trip (real samples)', () => {
  it('RFP: value lands in the answer cell, not next to the label; header Title is not a spot', async () => {
    const xml = await load('RFP-WEBSITE_REDESIGN_AND_HOSTING_final.docx');
    if (!xml) return;
    const spots = findDocxFillSpots(xml);

    // No spot should be the document header "Title:" (which is followed by the
    // RFP title text) — i.e. every Title: spot is a real table/label field.
    const titleSpots = spots.filter((s) => s.ref === 'Title:');
    expect(titleSpots.length).toBeGreaterThan(0);
    expect(titleSpots.every((s) => s.kind === 'TABLE_CELL_LABEL' || s.kind === 'TEXT_LABEL')).toBe(true);

    // Fill the first Signature: table-cell field.
    const sig = spots.find((s) => s.kind === 'TABLE_CELL_LABEL' && s.ref === 'Signature:');
    expect(sig).toBeDefined();
    const filled = xml.slice(0, sig!.spliceStart) + sig!.render('JANE DOE') + xml.slice(sig!.spliceEnd);

    // The value must NOT be glued onto the label run "Signature:JANE DOE".
    expect(filled).not.toContain('Signature:</w:t></w:r><w:r><w:t xml:space="preserve">JANE DOE');
    expect(filled.replace(/\s+/g, ' ')).not.toMatch(/Signature:\s*<\/w:t>[^<]*JANE DOE/);
    // The value is present (in the neighbouring answer cell).
    expect(filled).toContain('JANE DOE');

    // The two side-by-side signature blocks are distinguishable by context: the
    // vendor column ("FIRM") vs the agency column ("ROANOKE ..."). A gridSpan'd
    // header row must map to the correct physical answer columns.
    const titleLabels = spots.filter((s) => s.ref === 'Title:').map((s) => s.label);
    expect(titleLabels.some((l) => /FIRM/i.test(l))).toBe(true);
    expect(titleLabels.some((l) => /ROANOKE/i.test(l))).toBe(true);
  });

  it('ADDENDUM: underscore blanks are captioned and fillable', async () => {
    const xml = await load('ADDENDUM_1_121251_WEBSITE_REDESIGN.docx');
    if (!xml) return;
    const spots = findDocxFillSpots(xml);
    const refs = spots.map((s) => s.ref);
    expect(refs).toContain('Name of Firm');
    // Fill "Name of Firm": the value is written ON the line as an UNDERLINED run
    // (value text itself underlined), not floating after a "___" blob.
    const nf = spots.find((s) => s.ref === 'Name of Firm')!;
    const rendered = nf.render('Acme LLC');
    expect(rendered).toContain('Acme LLC');
    expect(rendered).toContain('<w:u w:val="single"/>'); // value text is underlined
    expect(rendered).not.toContain('____'); // no literal underscore characters
    const filled = xml.slice(0, nf.spliceStart) + rendered + xml.slice(nf.spliceEnd);
    expect(filled).toContain('Acme LLC');
    // The original literal-underscore run is gone (replaced by the underlined value).
    expect(filled).not.toContain('<w:t xml:space="preserve">____________</w:t>');
  });

  it('DSA (regression): still finds the same-line signature labels + tokens', async () => {
    const xml = await load('2025 Data Security Addendum Clean.docx');
    if (!xml) return;
    const spots = findDocxFillSpots(xml);
    const names = spots.filter((s) => s.ref === 'Name:' && s.kind === 'TEXT_LABEL');
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names.map((s) => s.occurrence)).size).toBe(names.length);
  });

  // Preview fidelity: injected markers must REPLACE throwaway placeholders
  // (□ / [token] / underscores), so the rendered preview never shows a leftover
  // beside the interactive field span (e.g. "☐□Corporation", "[span][INSERT…]").
  it.each([
    'RFP-WEBSITE_REDESIGN_AND_HOSTING_final.docx',
    'ADDENDUM_1_121251_WEBSITE_REDESIGN.docx',
    '2025 Data Security Addendum Clean.docx',
  ])('no leftover placeholder sits adjacent to a marker in %s', async (name) => {
    const xml = await load(name);
    if (!xml) return;
    const { xml: marked, spots } = injectFieldMarkers(xml);
    const re = new RegExp(`${FIELD_MARKER_OPEN}(\\d+)${FIELD_MARKER_CLOSE}`, 'g');
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(marked)) !== null) {
      const after = marked.slice(m.index + m[0].length, m.index + m[0].length + 4);
      // A leftover box/bracket/underscore immediately after a marker means the
      // placeholder wasn't removed for a replace-style spot.
      if (/^[□☐[]/.test(after) || /^_{3}/.test(after)) {
        offenders.push(`${spots[Number(m[1])].kind}: ${JSON.stringify(after)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
