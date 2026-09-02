import { buildContentDispositionHeader, encodeRFC5987ValueChars } from './content-disposition';

describe('encodeRFC5987ValueChars', () => {
  it('percent-encodes reserved attr-chars left unescaped by encodeURIComponent', () => {
    expect(encodeRFC5987ValueChars("a'b(c)d*e")).toBe('a%27b%28c%29d%2Ae');
  });

  it('percent-encodes non-ASCII characters as UTF-8', () => {
    expect(encodeRFC5987ValueChars('Café.pdf')).toBe('Caf%C3%A9.pdf');
  });

  it('leaves plain ASCII filenames untouched', () => {
    expect(encodeRFC5987ValueChars('report.pdf')).toBe('report.pdf');
  });
});

describe('buildContentDispositionHeader', () => {
  it('builds an attachment header with ASCII fallback and RFC-5987 filename* for a plain name', () => {
    expect(buildContentDispositionHeader('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('replaces non-ASCII characters in the ASCII fallback but preserves them in filename*', () => {
    const header = buildContentDispositionHeader('Café Proposal.pdf');
    expect(header).toBe(`attachment; filename="Caf_ Proposal.pdf"; filename*=UTF-8''Caf%C3%A9%20Proposal.pdf`);
  });

  it('replaces quotes and backslashes in the ASCII fallback', () => {
    const header = buildContentDispositionHeader('weird"name\\.pdf');
    expect(header).toContain('filename="weird_name_.pdf"');
  });

  it('supports an inline disposition', () => {
    expect(buildContentDispositionHeader('report.pdf', 'inline')).toBe(
      `inline; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });
});
