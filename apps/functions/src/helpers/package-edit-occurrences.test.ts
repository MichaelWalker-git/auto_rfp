import {
  findDocumentOccurrences,
  replaceInFieldValue,
  safeCompileRegex,
  findRegexOccurrences,
  findRegexInFieldValue,
} from './package-edit-occurrences';

const EMAIL = '[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}';

describe('findDocumentOccurrences', () => {
  it('finds EVERY occurrence of the token across the document (the recall fix)', () => {
    const text =
      'Call Reference: ACWS26 | Email: brennen@horustech.dev | AOS. ' +
      'Point of Contact: Brennen Stones, Manager | brennen@horustech.dev';
    const occ = findDocumentOccurrences(text, 'brennen@horustech.dev', 'new2.brennen@horus.tech');
    expect(occ).toHaveLength(2);
    for (const o of occ) {
      expect(o.after).toContain('new2.brennen@horus.tech');
      expect(o.after).not.toContain('brennen@horustech.dev');
    }
  });

  it('each occurrence before-context is unique within the document', () => {
    const text = 'Email: brennen@horustech.dev here. And brennen@horustech.dev there.';
    const occ = findDocumentOccurrences(text, 'brennen@horustech.dev', 'x@y.z');
    const befores = occ.map((o) => o.before);
    // Distinct contexts so the guarded apply can target exactly one spot each.
    expect(new Set(befores).size).toBe(befores.length);
  });

  it('returns nothing when the token is absent', () => {
    expect(findDocumentOccurrences('no match here', 'zzz', 'y')).toHaveLength(0);
  });

  it('matches across collapsed whitespace', () => {
    const occ = findDocumentOccurrences('Email:\n\n  brennen@horustech.dev', 'brennen@horustech.dev', 'x@y.z');
    expect(occ).toHaveLength(1);
    expect(occ[0].after).toContain('x@y.z');
  });
});

describe('replaceInFieldValue', () => {
  it('replaces every occurrence in a field value', () => {
    expect(replaceInFieldValue('a@x.com; a@x.com', 'a@x.com', 'b@y.com')).toBe('b@y.com; b@y.com');
  });
});

describe('safeCompileRegex (ReDoS + over-broad guard)', () => {
  it('compiles a normal email pattern', () => {
    expect(safeCompileRegex(EMAIL)).toBeInstanceOf(RegExp);
  });
  it('rejects match-anything patterns', () => {
    for (const p of ['.*', '.+', '^.*$', '  .*  ']) expect(safeCompileRegex(p)).toBeNull();
  });
  it('rejects nested/stacked unbounded quantifiers (catastrophic backtracking)', () => {
    for (const p of ['(a+)+', '(a*)*', '(.+)+', 'a++', 'a**']) expect(safeCompileRegex(p)).toBeNull();
  });
  it('SG-2: rejects quantified alternation-overlap shapes ((a|a)+, (a|ab)+)', () => {
    for (const p of ['(a|a)+', '(a|ab)+', '(foo|foo)*']) expect(safeCompileRegex(p)).toBeNull();
  });
  it('SG-2: still compiles legitimate patterns with unquantified alternation', () => {
    // A find pattern may use alternation without quantifying the group.
    expect(safeCompileRegex('(cat|dog)')).toBeInstanceOf(RegExp);
    expect(safeCompileRegex('\\$(2\\.0|2\\.4)M')).toBeInstanceOf(RegExp);
  });
  it('rejects invalid syntax and over-long patterns', () => {
    expect(safeCompileRegex('([')).toBeNull();
    expect(safeCompileRegex('a'.repeat(201))).toBeNull();
  });
});

describe('findRegexOccurrences (pattern + anchor)', () => {
  // Two Brennen email variants near his name, plus an unrelated billing email far
  // away (well beyond the anchor window) tied to a different person.
  const html =
    'Header POC: Brennen Stones | brennen@horustech.dev . ' +
    'Point of Contact Email: new2.brennen@horus.tech . ' +
    'x'.repeat(200) +
    ' Billing owner Dana Reed, accounts@vendor.com';

  it('catches BOTH Brennen email variants near the anchor (the real bug), not the unrelated one', () => {
    const re = safeCompileRegex(EMAIL)!;
    const matches = findRegexOccurrences(html, re, 'brand.new@horus.tech', 'Brennen');
    const anchored = matches.filter((m) => m.anchored);
    const matchedVals = anchored.map((m) => m.matched).sort();
    expect(matchedVals).toEqual(['brennen@horustech.dev', 'new2.brennen@horus.tech']);
    // The unrelated billing email (200+ chars from any "Brennen") is NOT anchored.
    const billing = matches.find((m) => m.matched === 'accounts@vendor.com');
    expect(billing?.anchored).toBe(false);
    for (const m of anchored) expect(m.after).toContain('brand.new@horus.tech');
  });

  it('skips a match already equal to the replacement', () => {
    const re = safeCompileRegex(EMAIL)!;
    const matches = findRegexOccurrences('Contact brennen: brand.new@horus.tech', re, 'brand.new@horus.tech', 'brennen');
    expect(matches).toHaveLength(0);
  });
});

describe('findRegexInFieldValue', () => {
  it('replaces the shape match and reports anchor presence', () => {
    const re = safeCompileRegex(EMAIL)!;
    const res = findRegexInFieldValue('Brennen — old.brennen@x.com', re, 'brand.new@horus.tech', 'Brennen');
    expect(res.matchedAny).toBe(true);
    expect(res.anchored).toBe(true);
    expect(res.after).toContain('brand.new@horus.tech');
  });
  it('leaves the value untouched when the anchor is absent from both label and value', () => {
    const re = safeCompileRegex(EMAIL)!;
    const res = findRegexInFieldValue('accounts@vendor.com', re, 'brand.new@horus.tech', 'Brennen');
    // Per-match anchoring: an out-of-context match is not replaced at all.
    expect(res.matchedAny).toBe(false);
    expect(res.anchored).toBe(false);
    expect(res.after).toBe('accounts@vendor.com');
  });

  it('replaces ONLY the anchored match, not a sibling value beyond the anchor window', () => {
    // The bug: a whole-field anchor + a single global replace clobbered BOTH
    // emails. With per-match window anchoring, only the email in the anchor's
    // window changes. Separate the two matches by more than ANCHOR_WINDOW (120).
    const re = safeCompileRegex(EMAIL)!;
    const filler = ' details '.repeat(20); // > 120 chars between the two emails
    const value = `Primary: alice@x.com${filler}Secondary: bob@x.com`;
    const res = findRegexInFieldValue(value, re, 'new@horus.tech', 'Primary');
    expect(res.matchedAny).toBe(true);
    expect(res.anchored).toBe(true);
    expect(res.after).toBe(`Primary: new@horus.tech${filler}Secondary: bob@x.com`);
    // The far sibling is preserved.
    expect(res.after).toContain('bob@x.com');
  });

  it('replaces every match when no anchor is given', () => {
    const re = safeCompileRegex(EMAIL)!;
    const res = findRegexInFieldValue('alice@x.com and bob@x.com', re, 'new@horus.tech');
    expect(res.matchedAny).toBe(true);
    expect(res.anchored).toBe(true);
    expect(res.after).toBe('new@horus.tech and new@horus.tech');
  });

  it('anchors on the field LABEL, not just the value (the phone-field bug)', () => {
    // Real case: value is the phone number, the anchor ("Phone") lives in the label.
    const PHONE = safeCompileRegex('\\(\\d{3}\\)\\s*\\d{3}-\\d{4}')!;
    const res = findRegexInFieldValue(
      '(480) 269-0424',
      PHONE,
      '937-99-92',
      'Phone',
      "VENDOR'S PRIMARY CONTACT — Phone",
    );
    expect(res.matchedAny).toBe(true);
    expect(res.anchored).toBe(true); // label carries the anchor
    expect(res.after).toBe('937-99-92');
  });
});
