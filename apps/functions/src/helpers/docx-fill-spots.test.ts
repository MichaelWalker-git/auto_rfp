import { findDocxFillSpots, injectFieldMarkers, FIELD_MARKER_OPEN } from './docx-fill-spots';

const para = (inner: string): string => `<w:p>${inner}</w:p>`;
const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (inner: string): string => `<w:tc><w:tcPr/>${inner}</w:tc>`;
const rowOf = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string => `<w:tbl>${rows.join('')}</w:tbl>`;
const doc = (body: string): string =>
  `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

const apply = (xml: string, kind: string, ref: string, occurrence: number, value: string): string => {
  const spot = findDocxFillSpots(xml).find((s) => s.kind === kind && s.ref === ref && s.occurrence === occurrence);
  if (!spot) throw new Error(`spot not found: ${kind} ${ref} ${occurrence}`);
  return xml.slice(0, spot.spliceStart) + spot.render(value) + xml.slice(spot.spliceEnd);
};

describe('findDocxFillSpots — TEXT_TOKEN', () => {
  it('finds a bracket token and renders the value in place of the token only', () => {
    const xml = doc(para(run('Vendor: [INSERT SUPPLIER NAME] here')));
    const spots = findDocxFillSpots(xml);
    const tok = spots.find((s) => s.kind === 'TEXT_TOKEN');
    expect(tok?.ref).toBe('[INSERT SUPPLIER NAME]');
    const filled = xml.slice(0, tok!.spliceStart) + tok!.render('Acme') + xml.slice(tok!.spliceEnd);
    expect(filled).toContain('Vendor: Acme here');
  });

  it('emits one spot per token occurrence (so the filler can fill all)', () => {
    const xml = doc(para(run('[CO]')) + para(run('and [CO]')));
    const spots = findDocxFillSpots(xml).filter((s) => s.kind === 'TEXT_TOKEN' && s.ref === '[CO]');
    expect(spots).toHaveLength(2);
    expect(spots.map((s) => s.occurrence)).toEqual([0, 1]);
  });
});

describe('findDocxFillSpots — TEXT_LABEL (same-line)', () => {
  it('treats a whole-paragraph label as fillable', () => {
    const xml = doc(para(run('Name:')));
    const spots = findDocxFillSpots(xml);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0 });
  });

  it('does NOT treat a header ("Title: <content>") as a label', () => {
    const xml = doc(para(run('Title:') + run(' WEBSITE REDESIGN')));
    expect(findDocxFillSpots(xml)).toHaveLength(0);
  });

  it('renders the value after the label, preserving the label text', () => {
    const xml = doc(para(run('Title:')));
    const filled = apply(xml, 'TEXT_LABEL', 'Title:', 0, 'CEO');
    expect(filled).toContain('Title: CEO');
  });
});

describe('findDocxFillSpots — TABLE_CELL_LABEL', () => {
  const twoCell = doc(
    table(rowOf(cell(para(run('Signature:'))), cell(para(run(''))))),
  );

  it('detects a label cell whose answer belongs in the neighbouring cell', () => {
    const spots = findDocxFillSpots(twoCell);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ kind: 'TABLE_CELL_LABEL', ref: 'Signature:' });
  });

  it('writes the value into the answer cell, not next to the label', () => {
    const filled = apply(twoCell, 'TABLE_CELL_LABEL', 'Signature:', 0, 'JANE DOE');
    // Value present, and NOT glued onto the label text.
    expect(filled).toContain('JANE DOE');
    expect(filled).not.toContain('Signature:</w:t></w:r><w:r><w:t xml:space="preserve">JANE DOE');
    // The value run lands after the label cell closes (in the second cell).
    const labelEnd = filled.indexOf('Signature:');
    const valueAt = filled.indexOf('JANE DOE');
    const secondCellAt = filled.indexOf('<w:tc>', filled.indexOf('<w:tc>') + 1);
    expect(valueAt).toBeGreaterThan(secondCellAt);
    expect(valueAt).toBeGreaterThan(labelEnd);
  });

  it('does not treat a label cell as fillable when the neighbour cell already has content', () => {
    const xml = doc(table(rowOf(cell(para(run('Title:'))), cell(para(run('Pre-filled value'))))));
    expect(findDocxFillSpots(xml).filter((s) => s.kind === 'TABLE_CELL_LABEL')).toHaveLength(0);
  });

  it('labels side-by-side signature columns from a gridSpan header row', () => {
    // Header row: | FIRM (span2) | AGENCY (span2) |. Field row: 4 physical cells
    // Title:|blank|Title:|blank at grid cols 0,1,2,3. Col 0 → FIRM, col 2 → AGENCY.
    const spanCell = (n: number, inner: string) =>
      `<w:tc><w:tcPr><w:gridSpan w:val="${n}"/></w:tcPr>${inner}</w:tc>`;
    const xml = doc(
      table(
        rowOf(spanCell(2, para(run('FIRM'))), spanCell(2, para(run('AGENCY')))),
        rowOf(cell(para(run('Title:'))), cell(para(run(''))), cell(para(run('Title:'))), cell(para(run('')))),
      ),
    );
    const titles = findDocxFillSpots(xml).filter((s) => s.ref === 'Title:');
    expect(titles).toHaveLength(2);
    expect(titles[0].label).toBe('FIRM — Title:');
    expect(titles[1].label).toBe('AGENCY — Title:');
  });
});

describe('findDocxFillSpots — UNDERSCORE_BLANK', () => {
  it('captions an underscore blank from the following paragraph', () => {
    const xml = doc(para(run('____________')) + para(run('Name of Firm')));
    const spots = findDocxFillSpots(xml);
    const blank = spots.find((s) => s.kind === 'UNDERSCORE_BLANK');
    expect(blank?.ref).toBe('Name of Firm');
    const filled = xml.slice(0, blank!.spliceStart) + blank!.render('Acme LLC') + xml.slice(blank!.spliceEnd);
    expect(filled).toContain('Acme LLC');
    expect(filled).not.toContain('____________');
  });

  it('indexes multiple underscore blanks per occurrence', () => {
    const xml = doc(
      para(run('____________')) + para(run('Name of Firm')) +
      para(run('____________')) + para(run('Signature/Title')),
    );
    const blanks = findDocxFillSpots(xml).filter((s) => s.kind === 'UNDERSCORE_BLANK');
    expect(blanks.map((b) => b.ref)).toEqual(['Name of Firm', 'Signature/Title']);
  });

  it('detects an INLINE underscore blank (underscores glued to label text in one run)', () => {
    const xml = doc(para(run('eMail:____________________')));
    const blank = findDocxFillSpots(xml).find((s) => s.kind === 'UNDERSCORE_BLANK');
    expect(blank).toBeDefined();
    expect(blank!.ref.toLowerCase()).toContain('email');
    // The splice targets ONLY the underscores, inside the <w:t> body.
    const filled = xml.slice(0, blank!.spliceStart) + blank!.render('a@b.com') + xml.slice(blank!.spliceEnd);
    // Label preserved, underscores replaced by the value, XML still well-formed.
    expect(filled).toContain('eMail:');
    expect(filled).toContain('a@b.com');
    expect(filled).not.toContain('____________________');
    // No stray/nested run injected inside the <w:t>.
    expect(filled).toMatch(/<w:t xml:space="preserve">eMail:a@b\.com ____<\/w:t>/);
  });

  it('detects TWO inline blanks in a single run (e.g. "No.___ and Date:___")', () => {
    const xml = doc(para(run('Certification No.__________and Expiration Date:__________')));
    const blanks = findDocxFillSpots(xml).filter((s) => s.kind === 'UNDERSCORE_BLANK');
    expect(blanks).toHaveLength(2);
    // Fill both, applying at descending offsets so positions stay valid.
    let filled = xml;
    for (const b of [...blanks].sort((a, z) => z.spliceStart - a.spliceStart)) {
      filled = filled.slice(0, b.spliceStart) + b.render('X') + filled.slice(b.spliceEnd);
    }
    expect(filled).toContain('Certification No.');
    expect(filled).toContain('Expiration Date:');
    expect(filled).not.toContain('__________');
  });
});

describe('findDocxFillSpots — nested tables', () => {
  it('does not mis-close a table cell that contains a nested table', () => {
    const inner = table(rowOf(cell(para(run('inner')))));
    const xml = doc(table(rowOf(cell(para(run('Title:')) + inner), cell(para(run(''))))));
    // The outer label cell + its blank neighbour still resolve despite the nested table.
    const spots = findDocxFillSpots(xml);
    expect(spots.some((s) => s.kind === 'TABLE_CELL_LABEL' && s.ref === 'Title:')).toBe(true);
  });
});

describe('injectFieldMarkers', () => {
  it('places an INLINE-blank marker as bare text inside the <w:t>, not a nested run', () => {
    const xml = doc(para(run('eMail:____________')));
    const { xml: marked, spots } = injectFieldMarkers(xml);
    expect(spots).toHaveLength(1);
    // The marker sits inside the text body right after the label — no <w:r>
    // wrapper nested inside <w:t> (which would be invalid OOXML).
    expect(marked).toMatch(new RegExp(`eMail:${FIELD_MARKER_OPEN}0`));
    expect(marked).not.toContain('<w:t xml:space="preserve">eMail:<w:r>');
  });

  it('wraps a boundary marker (table cell insert) in its own <w:r>', () => {
    const xml = doc(table(rowOf(cell(para(run('Signature:'))), cell(para(run('')))))); // label→answer
    const { xml: marked, spots } = injectFieldMarkers(xml);
    expect(spots).toHaveLength(1);
    // The answer-cell insert is a full run so it's valid block content.
    expect(marked).toContain(`<w:r><w:t xml:space="preserve">${FIELD_MARKER_OPEN}0`);
  });

  it('REPLACES the box glyph so the preview has no leftover □ beside the field span', () => {
    const xml = doc(para(run('□Corporation')));
    const { xml: marked } = injectFieldMarkers(xml);
    // The raw box glyph is gone (replaced by the marker); only the label remains.
    expect(marked).not.toContain('□');
    expect(marked).toMatch(new RegExp(`${FIELD_MARKER_OPEN}0.*Corporation`));
  });

  it('REPLACES a bracket token so it does not linger beside the field span', () => {
    const xml = doc(para(run('Vendor: [INSERT SUPPLIER NAME] here')));
    const { xml: marked } = injectFieldMarkers(xml);
    expect(marked).not.toContain('[INSERT SUPPLIER NAME]');
    expect(marked).toContain(`Vendor: ${FIELD_MARKER_OPEN}0`);
  });

  it('REPLACES inline underscores so they do not linger beside the field span', () => {
    const xml = doc(para(run('eMail:____________')));
    const { xml: marked } = injectFieldMarkers(xml);
    expect(marked).not.toContain('____________');
    expect(marked).toMatch(new RegExp(`eMail:${FIELD_MARKER_OPEN}0`));
  });

  it('KEEPS the label for a same-line TEXT_LABEL, placing the marker AFTER it', () => {
    // "Name:" is its own paragraph → TEXT_LABEL. The label must survive in the
    // preview, with the marker following it (so it reads "Name: <value>").
    const xml = doc(para(run('Name:')));
    const { xml: marked } = injectFieldMarkers(xml);
    expect(marked).toContain('Name:');
    expect(marked).toMatch(new RegExp(`Name:</w:t>.*${FIELD_MARKER_OPEN}0|Name:${FIELD_MARKER_OPEN}0`));
  });
});

describe('findDocxFillSpots — CHECKBOX', () => {
  it('detects a box glued to its option label ("□Corporation")', () => {
    const xml = doc(para(run('Check all that apply: □Corporation')));
    const cb = findDocxFillSpots(xml).find((s) => s.kind === 'CHECKBOX');
    expect(cb).toBeDefined();
    expect(cb!.ref).toBe('Corporation');
    expect(cb!.markType).toBe('CHECKBOX');
  });

  it('borrows the label from the NEXT run when the box is its own run', () => {
    const xml = doc(para(run('□') + run('Yes') + run('□') + run('No')));
    const cbs = findDocxFillSpots(xml).filter((s) => s.kind === 'CHECKBOX');
    expect(cbs.map((c) => c.ref)).toEqual(['Yes', 'No']);
  });

  it('ticking renders ☒ in place of the box; unticked leaves □', () => {
    const xml = doc(para(run('□Micro')));
    const cb = findDocxFillSpots(xml).find((s) => s.kind === 'CHECKBOX')!;
    // Splice targets only the single box glyph.
    expect(cb.spliceEnd - cb.spliceStart).toBe(1);
    const ticked = xml.slice(0, cb.spliceStart) + cb.render('X') + xml.slice(cb.spliceEnd);
    expect(ticked).toContain('☒Micro');
    const unticked = xml.slice(0, cb.spliceStart) + cb.render('') + xml.slice(cb.spliceEnd);
    expect(unticked).toContain('□Micro');
  });

  it('assigns per-occurrence indices to repeated option labels', () => {
    const xml = doc(para(run('□Yes')) + para(run('□Yes')));
    const yes = findDocxFillSpots(xml).filter((s) => s.kind === 'CHECKBOX' && s.ref === 'Yes');
    expect(yes.map((c) => c.occurrence)).toEqual([0, 1]);
  });
});
