import { decodeHtmlEntities, stripHtmlToText } from './html-text';

describe('decodeHtmlEntities', () => {
  it('decodes the common named and numeric entities', () => {
    expect(decodeHtmlEntities('Design &amp; build &lt;5 services&gt; &quot;fast&quot; &#39;now&#39;')).toBe(
      'Design & build <5 services> "fast" \'now\'',
    );
    expect(decodeHtmlEntities('&#039;a&#x27;b')).toBe("'a'b");
    expect(decodeHtmlEntities('A&nbsp;B')).toBe('A B');
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
