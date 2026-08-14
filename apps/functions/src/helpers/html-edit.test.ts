import { applyHtmlEdit } from './html-edit';

describe('applyHtmlEdit', () => {
  it('matches plain-text before against HTML with inline tags and rewrites in place', () => {
    const html = '<p>The total cost is <strong>$2.0M</strong> for the base year.</p>';
    const res = applyHtmlEdit(html, 'The total cost is $2.0M for the base year.', 'The total cost is $2.4M for the base year.');
    expect(res.status).toBe('applied');
    // Surrounding <p> preserved; the value changed.
    expect(res.html).toContain('<p>');
    expect(res.html).toContain('$2.4M');
    expect(res.html).not.toContain('$2.0M');
  });

  it('matches across &nbsp; and collapsed whitespace', () => {
    const html = '<p>Phone:&nbsp;&nbsp;<span>555-0100</span></p>';
    const res = applyHtmlEdit(html, 'Phone: 555-0100', 'Phone: 555-0199');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('555-0199');
  });

  it('matches across decoded entities (&amp;)', () => {
    const html = '<p>Research &amp; Development budget: $10k</p>';
    const res = applyHtmlEdit(html, 'Research & Development budget: $10k', 'Research & Development budget: $12k');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$12k');
    // The literal entity in the untouched prefix stays intact.
    expect(res.html).toContain('Research &amp; Development');
  });

  it('C2: matches across a curly apostrophe entity (&rsquo;) in the context span', () => {
    // The propose engine builds `before` via decodeHtmlEntities, which turns
    // &rsquo; into ’. buildPlainMap must decode the SAME entity or this edit is
    // silently reported skipped-stale. Regression for the 6-vs-full entity gap.
    const html = "<p>The vendor&rsquo;s total cost is <strong>$2.0M</strong>.</p>";
    const res = applyHtmlEdit(html, 'The vendor’s total cost is $2.0M.', 'The vendor’s total cost is $2.4M.');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$2.4M');
    expect(res.html).not.toContain('$2.0M');
  });

  it('C2: matches across em-dash and ellipsis entities (&mdash;, &hellip;)', () => {
    const html = '<p>Scope&mdash;phase one&hellip; is <em>$5k</em>.</p>';
    const res = applyHtmlEdit(html, 'Scope—phase one… is $5k.', 'Scope—phase one… is $6k.');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$6k');
  });

  it('C2: matches a case-variant numeric/nbsp entity the same way decodeHtmlEntities does', () => {
    // &#X27; (uppercase hex) and &NBSP; are matched case-insensitively by the shared table.
    const html = '<p>It&#X27;s&NBSP;<strong>$10</strong> total.</p>';
    const res = applyHtmlEdit(html, "It's $10 total.", "It's $12 total.");
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$12');
  });

  it('reports not-found when the plain text is absent', () => {
    const html = '<p>Something entirely different.</p>';
    const res = applyHtmlEdit(html, 'The total cost is $2.0M', 'The total cost is $2.4M');
    expect(res.status).toBe('not-found');
    expect(res.occurrences).toBe(0);
    expect(res.html).toBeUndefined();
  });

  it('reports ambiguous when the plain text appears more than once', () => {
    const html = '<p>$2.0M here</p><div>and $2.0M there</div>';
    const res = applyHtmlEdit(html, '$2.0M', '$2.4M');
    expect(res.status).toBe('ambiguous');
    expect(res.occurrences).toBe(2);
    expect(res.html).toBeUndefined();
  });

  it('escapes HTML-special characters in the replacement', () => {
    const html = '<p>Vendor: ACME</p>';
    const res = applyHtmlEdit(html, 'Vendor: ACME', 'Vendor: A&B <Corp>');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('A&amp;B &lt;Corp&gt;');
  });

  it('handles a needle whose whitespace differs from the HTML (newlines/tabs)', () => {
    const html = '<p>Line one\n   and   line two</p>';
    const res = applyHtmlEdit(html, 'Line one and line two', 'Line one and line three');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('line three');
  });

  it('replaces only the matched span, leaving following text intact', () => {
    const html = '<p>Set the fee to $100. The fee applies annually.</p>';
    const res = applyHtmlEdit(html, 'Set the fee to $100.', 'Set the fee to $150.');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$150.');
    expect(res.html).toContain('The fee applies annually.');
  });

  it('returns not-found for an empty needle', () => {
    expect(applyHtmlEdit('<p>x</p>', '   ', 'y').status).toBe('not-found');
  });

  // ─── Tag-balance regression: a match crossing a formatting boundary must NOT
  //     leave an unclosed tag that bleeds formatting into the rest of the doc. ──

  it('does not leave an unclosed tag when the match STARTS inside a <strong>', () => {
    // Match begins at "$2.0M" (inside <strong>) and runs past </strong>.
    const html = '<p>Cost is <strong>$2.0M</strong> for the base period. Next sentence.</p>';
    const res = applyHtmlEdit(html, '$2.0M for the base period.', '$2.4M for the base period.');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('$2.4M for the base period.');
    // Tag balance preserved: exactly as many <strong> as </strong>.
    const open = (res.html!.match(/<strong>/g) ?? []).length;
    const close = (res.html!.match(/<\/strong>/g) ?? []).length;
    expect(open).toBe(close);
    // The trailing text is not swallowed into a bold run.
    expect(res.html).toContain('Next sentence.');
  });

  it('does not leave a dangling close tag when the match ENDS inside a <strong>', () => {
    // Match starts before <strong> and ends inside it (at "2.0M").
    const html = '<p>The fee is <strong>$2.0M annually</strong>.</p>';
    const res = applyHtmlEdit(html, 'The fee is $2.0M', 'The fee is $2.4M');
    expect(res.status).toBe('applied');
    const open = (res.html!.match(/<strong>/g) ?? []).length;
    const close = (res.html!.match(/<\/strong>/g) ?? []).length;
    expect(open).toBe(close);
    expect(res.html).toContain('$2.4M');
    expect(res.html).toContain('annually');
  });

  it('removes a tag pair left empty when the whole styled text is replaced', () => {
    const html = '<p>Label: <strong>OLD</strong> end</p>';
    const res = applyHtmlEdit(html, 'Label: OLD end', 'Label: NEW end');
    expect(res.status).toBe('applied');
    expect(res.html).toContain('NEW');
    // The now-empty <strong></strong> is stripped, not left as clutter.
    expect(res.html).not.toContain('<strong></strong>');
    const open = (res.html!.match(/<strong>/g) ?? []).length;
    const close = (res.html!.match(/<\/strong>/g) ?? []).length;
    expect(open).toBe(close);
  });

  it('preserves an inner tag boundary when the match spans two styled spans', () => {
    const html = '<p>Total <strong>alpha</strong> and <em>beta</em> done.</p>';
    const res = applyHtmlEdit(html, 'alpha and beta', 'gamma');
    expect(res.status).toBe('applied');
    // No unbalanced strong/em.
    for (const tag of ['strong', 'em']) {
      const open = (res.html!.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
      const close = (res.html!.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      expect(open).toBe(close);
    }
    expect(res.html).toContain('gamma');
    expect(res.html).toContain('done.');
  });
});
