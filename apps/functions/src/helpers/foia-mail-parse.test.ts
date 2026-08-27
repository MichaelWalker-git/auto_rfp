import { parseRawMail, readMailHeader, stripQuotedReply } from './foia-mail-parse';

/** Builds a raw message with CRLF line endings, as SES delivers them. */
const raw = (lines: string[]): string => lines.join('\r\n');

describe('readMailHeader', () => {
  it('reads a header value', () => {
    const message = raw(['From: a@b.gov', 'Subject: Award Notice', '', 'body']);

    expect(readMailHeader(message, 'Subject')).toBe('Award Notice');
    expect(readMailHeader(message, 'from')).toBe('a@b.gov');
  });

  it('unfolds a continuation line', () => {
    // Long subjects are folded in real mail; a naive read truncates them, which
    // would drop the solicitation number the correlator needs.
    const message = raw([
      'Subject: Texas Public Information Act Request',
      '  — RFP 739-SL3722874, Student Prospect',
      '',
      'body',
    ]);

    expect(readMailHeader(message, 'Subject')).toBe(
      'Texas Public Information Act Request — RFP 739-SL3722874, Student Prospect',
    );
  });

  it('returns undefined for an absent header', () => {
    expect(readMailHeader(raw(['From: a@b.gov', '', 'body']), 'Reply-To')).toBeUndefined();
  });
});

describe('parseRawMail — simple messages', () => {
  it('reads a plain-text body', () => {
    const message = raw([
      'From: foia@ttu.edu',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Please see the attached responsive documents.',
    ]);

    expect(parseRawMail(message).text).toBe('Please see the attached responsive documents.');
  });

  it('tolerates LF-only line endings', () => {
    const message = 'From: a@b.gov\nContent-Type: text/plain\n\nAward notice posted.';

    expect(parseRawMail(message).text).toBe('Award notice posted.');
  });

  it('falls back to the raw body when there is no usable part', () => {
    // Classification must always have something to work with.
    const message = raw(['From: a@b.gov', 'Content-Type: application/octet-stream', '', 'raw text']);

    expect(parseRawMail(message).text).toBe('raw text');
  });
});

describe('parseRawMail — transfer encodings', () => {
  it('decodes quoted-printable, including soft line breaks', () => {
    const message = raw([
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Solicitation W912DY-24-R-0001 was=',
      ' cancelled.',
    ]);

    expect(parseRawMail(message).text).toBe('Solicitation W912DY-24-R-0001 was cancelled.');
  });

  it('decodes multi-byte characters rather than mangling them', () => {
    // Agency letters contain em dashes and curly quotes. Byte-wise decoding turns
    // them into mojibake, which breaks phrase matching on the surrounding words.
    const message = raw([
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Request =E2=80=94 RFP 739-SL3722874',
    ]);

    expect(parseRawMail(message).text).toBe('Request — RFP 739-SL3722874');
  });

  it('decodes base64', () => {
    const body = Buffer.from('Notice of Award: 36C24826Q0460', 'utf8').toString('base64');
    const message = raw([
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      body,
    ]);

    expect(parseRawMail(message).text).toBe('Notice of Award: 36C24826Q0460');
  });
});

describe('parseRawMail — multipart', () => {
  const multipart = raw([
    'From: Barclay.White@ttuhsc.edu',
    'Content-Type: multipart/mixed; boundary="BOUND1"',
    '',
    'preamble text that must be ignored',
    '--BOUND1',
    'Content-Type: text/plain',
    '',
    'Please see the attached responsive documents.',
    '--BOUND1',
    'Content-Type: application/pdf; name="Evaluation Sheet.pdf"',
    'Content-Disposition: attachment; filename="Evaluation Sheet.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQK',
    '--BOUND1--',
    'epilogue',
  ]);

  it('extracts the text part and ignores the preamble', () => {
    const { text } = parseRawMail(multipart);

    expect(text).toBe('Please see the attached responsive documents.');
    expect(text).not.toContain('preamble');
    expect(text).not.toContain('epilogue');
  });

  it('records attachment names without decoding their bytes', () => {
    const { text, attachmentNames } = parseRawMail(multipart);

    expect(attachmentNames).toEqual(['Evaluation Sheet.pdf']);
    // The PDF bytes must not leak into the classification haystack.
    expect(text).not.toContain('JVBERi');
  });

  it('prefers the plain part over the HTML alternative', () => {
    // The plain part is what the sender wrote; the HTML is a rendering of it.
    const message = raw([
      'Content-Type: multipart/alternative; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain',
      '',
      'plain version',
      '--B',
      'Content-Type: text/html',
      '',
      '<p>html version</p>',
      '--B--',
    ]);

    expect(parseRawMail(message).text).toBe('plain version');
  });

  it('falls back to HTML when there is no plain part', () => {
    const message = raw([
      'Content-Type: multipart/alternative; boundary="B"',
      '',
      '--B',
      'Content-Type: text/html',
      '',
      '<p>Award <b>notice</b> for RFP 26-16</p>',
      '--B--',
    ]);

    // Inline tags collapse to single spaces, so the sentence stays matchable.
    expect(parseRawMail(message).text).toContain('Award notice for RFP 26-16');
  });

  it('handles nested multiparts', () => {
    const message = raw([
      'Content-Type: multipart/mixed; boundary="OUT"',
      '',
      '--OUT',
      'Content-Type: multipart/alternative; boundary="IN"',
      '',
      '--IN',
      'Content-Type: text/plain',
      '',
      'nested body',
      '--IN--',
      '--OUT--',
    ]);

    expect(parseRawMail(message).text).toBe('nested body');
  });
});

describe('parseRawMail — hostile and malformed input', () => {
  it('strips script and style content from HTML', () => {
    // Otherwise CSS and JS tokens enter the haystack, where they can only create
    // spurious phrase matches.
    const message = raw([
      'Content-Type: text/html',
      '',
      '<style>.award { color: red }</style><script>var cancelled=1</script><p>Real body</p>',
    ]);

    const { text } = parseRawMail(message);

    expect(text).toContain('Real body');
    expect(text).not.toContain('color');
    expect(text).not.toContain('var cancelled');
  });

  it('does not hang on a boundary that never closes', () => {
    const message = raw([
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain',
      '',
      'orphaned part',
    ]);

    expect(() => parseRawMail(message)).not.toThrow();
  });

  it('bounds recursion on deeply nested parts', () => {
    // A malformed or hostile message must not be able to make ingestion spin.
    let body = 'deep';
    for (let i = 0; i < 30; i += 1) {
      body = raw([
        `Content-Type: multipart/mixed; boundary="B${i}"`,
        '',
        `--B${i}`,
        body,
        `--B${i}--`,
      ]);
    }

    expect(() => parseRawMail(body)).not.toThrow();
  });

  it('returns empty text for an empty message rather than throwing', () => {
    expect(parseRawMail('').text).toBe('');
    expect(parseRawMail('').attachmentNames).toEqual([]);
  });
});

describe('stripQuotedReply', () => {
  it('keeps only the agency prose above a Gmail attribution line', () => {
    // Real shape from obc93sn2d5kk. Note the narrow no-break space (U+202F) before
    // "AM", which Gmail emits and which broke a first attempt at this pattern, and
    // the attribution wrapping across two lines.
    const body = [
      'Hi Krystal,',
      '',
      'I am forwarding you the request for records I received.',
      '',
      'On Mon, Aug 17, 2026 at 10:33 AM Brennen Stones <brennen@horustech.dev>',
      'wrote:',
      '',
      '> Pursuant to the California Public Records Act, I am requesting copies of the',
      '> following public records related to RFP No. 26-22.',
    ].join('\n');

    const stripped = stripQuotedReply(body);

    expect(stripped).toContain('I am forwarding you the request for records I received.');
    expect(stripped).not.toContain('Pursuant to the California Public Records Act');
  });

  it('cuts at an Outlook From: block naming us', () => {
    const body = [
      'All requests that fall under CPRA must be submitted through this link.',
      '',
      '________________________________',
      '*From:* Brennen Stones <brennen@horustech.dev>',
      '*Sent:* Monday, August 17, 2026',
      '',
      'This is a request under the California Public Records Act.',
    ].join('\n');

    expect(stripQuotedReply(body)).not.toContain('This is a request under');
  });

  it('returns the whole body when nothing is quoted from us', () => {
    // A genuine outbound letter is entirely ours, and the outbound rules are meant
    // to match it — stripping here would make our own request unrecognisable.
    const ourLetter =
      'Pursuant to the California Public Records Act, I am requesting copies of the ' +
      'following public records. The undersigned will pay statutory fees.';

    expect(stripQuotedReply(ourLetter)).toBe(ourLetter);
  });

  it('does not cut at a marker naming the agency', () => {
    /**
     * Two real messages (`i3o2h82ak04i`, `615sciteu2kj`) open with a forwarded
     * separator at offset 0, because we forwarded the agency's reply to the mailbox.
     * Cutting at the first marker of any kind would discard the agency's words
     * entirely — the opposite of the intent.
     */
    const body = [
      '---------- Forwarded message ---------',
      'From: Channel Coast District Contract Bids <bids@parks.ca.gov>',
      '',
      'Unfortunately, C25910004 was cancelled and not awarded via IFB.',
    ].join('\n');

    expect(stripQuotedReply(body)).toContain('was cancelled and not awarded');
  });

  /**
   * The attribution must be anchored to a line start, with `On` matched case-sensitively.
   *
   * The unanchored, case-insensitive `\bOn\b` matched the lowercase "on" inside the
   * agency's OWN sentence, and because `isOurs` is tested against the whole 200-char
   * span, one of our addresses further along the line made that "on" the cut point.
   * This body was truncated to "Based " — losing the agency's answer, and the
   * NO_RECORDS_LOCATED outcome that depends on reading it.
   */
  it('does not cut at a lowercase "on" inside the agency\'s own prose', () => {
    const body = [
      'Based on a search of our files, no records were located for this request.',
      '',
      'On Mon, Aug 17, 2026 at 10:33 AM Brennen Stones <brennen@horustech.dev> wrote:',
      '> Pursuant to the California Public Records Act, I am requesting records.',
    ].join('\n');

    const kept = stripQuotedReply(body);

    expect(kept).toContain('no records were located');
    expect(kept).not.toContain('Pursuant to the California Public Records Act');
  });

  /**
   * A cut at offset 0 must not fall back to the whole body.
   *
   * A reply opening "On review of our files…" puts a cut at 0, and returning the body
   * unchanged let our entire quoted letter back into the authorship haystack — the very
   * defect this function exists to prevent, so the reply still booked as
   * OUR_OWN_REQUEST. The first NON-ZERO cut is the usable one.
   */
  it('prefers the first non-zero cut over returning the whole body', () => {
    const body = [
      'On review of our files we located no records. Contact brennen@horustech.dev wrote:',
      'From: Brennen Stones <brennen@horustech.dev>',
      'Pursuant to the CPRA, I am requesting the notice of award.',
    ].join('\n');

    const kept = stripQuotedReply(body);

    expect(kept).not.toContain('Pursuant to the CPRA');
    expect(kept).toContain('we located no records');
  });

  it('still returns a genuine outbound letter of ours in full', () => {
    // Every cut sits at 0 here, and an empty haystack would classify nothing — the
    // outbound rules are meant to match our own letter.
    const ours =
      'Pursuant to the California Public Records Act, I am requesting copies of the ' +
      'notice of award. Contact brennen@horustech.dev with questions.';

    expect(stripQuotedReply(ours)).toBe(ours);
  });
});
