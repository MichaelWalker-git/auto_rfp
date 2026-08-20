import { decodeHtmlEntities, matchHtmlEntityAt, HTML_ENTITIES, stripHtmlToText } from './html-text';

describe('decodeHtmlEntities', () => {
  it('decodes the common named and numeric entities', () => {
    expect(decodeHtmlEntities('Design &amp; build &lt;5 services&gt; &quot;fast&quot; &#39;now&#39;')).toBe(
      'Design & build <5 services> "fast" \'now\'',
    );
    expect(decodeHtmlEntities('&#039;a&#x27;b')).toBe("'a'b");
    expect(decodeHtmlEntities('A&nbsp;B')).toBe('A B');
  });

  it('matches numeric/nbsp entities case-insensitively', () => {
    expect(decodeHtmlEntities('It&#X27;s&NBSP;here')).toBe("It's here");
  });

  it('decodes typographic entities', () => {
    expect(decodeHtmlEntities('&mdash;&ndash;&hellip;&rsquo;&lsquo;&rdquo;&ldquo;&bull;&trade;&copy;&reg;')).toBe(
      '—–…’‘”“•™©®',
    );
  });

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here');
  });
});

describe('matchHtmlEntityAt (shared with html-edit)', () => {
  it('decodes every entity to the same char decodeHtmlEntities produces', () => {
    // Guards the html-edit projection against drifting from the regex decoder:
    // every table entry, matched at offset 0, yields the same char as decoding it.
    for (const { entity } of HTML_ENTITIES) {
      const matched = matchHtmlEntityAt(entity, 0);
      expect(matched?.char).toBe(decodeHtmlEntities(entity));
    }
  });

  it('returns undefined when no entity begins at the offset', () => {
    expect(matchHtmlEntityAt('plain & text', 6)).toBeUndefined();
  });
});

describe('stripHtmlToText', () => {
  it('replaces tags with spaces so words do not merge across elements', () => {
    expect(stripHtmlToText('<h2>Architecture</h2><p>Serverless&nbsp;three-tier   design.</p>')).toBe(
      'Architecture Serverless three-tier design.',
    );
  });

  it('supports a custom tag replacement', () => {
    expect(stripHtmlToText('<b>a</b><i>b</i>', { tagReplacement: '' })).toBe('ab');
  });

  it('collapses all whitespace and trims', () => {
    expect(stripHtmlToText('  <p>a</p>\n\n<p>b</p>  ')).toBe('a b');
  });

  it('returns an empty string for markup-only input', () => {
    expect(stripHtmlToText('<div><p>  </p></div>')).toBe('');
  });
});
