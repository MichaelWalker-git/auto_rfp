import { csvCell, slug } from '../csv';

describe('csvCell', () => {
  it('wraps a plain value in double quotes', () => {
    expect(csvCell('Alpha')).toBe('"Alpha"');
  });

  it('renders null/undefined as an empty quoted cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('stringifies numbers', () => {
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(0)).toBe('"0"');
  });

  it('doubles embedded double quotes (RFC 4180)', () => {
    expect(csvCell('The "Big" RFP')).toBe('"The ""Big"" RFP"');
  });

  describe('formula-injection neutralization', () => {
    it.each([
      ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
      ['=x', `"'=x"`],
      ['+x', `"'+x"`],
      ['-x', `"'-x"`],
      ['@x', `"'@x"`],
      ['+1+1', `"'+1+1"`],
      ['-2+3', `"'-2+3"`],
      ['@SUM(A1:A9)', `"'@SUM(A1:A9)"`],
      ['\t=x', `"'\t=x"`],
    ])('prefixes a single quote to values starting with a formula trigger: %s', (input, expected) => {
      expect(csvCell(input)).toBe(expected);
    });

    it('does not escape leading whitespace followed by a NON-trigger character', () => {
      // A bare tab/space before plain text is not a formula, so it stays untouched.
      expect(csvCell('\tcmd')).toBe('"\tcmd"');
      expect(csvCell('  hello')).toBe('"  hello"');
    });

    it('neutralizes a trigger hidden behind leading whitespace (bypass fix)', () => {
      // Leading spaces previously slipped an =HYPERLINK past the first-char check.
      expect(csvCell('  =SUM(A1)')).toBe(`"'  =SUM(A1)"`);
      // Leading newline / carriage return also count as whitespace before a trigger.
      expect(csvCell('\n=cmd')).toBe(`"'\n=cmd"`);
      expect(csvCell('\r@x')).toBe(`"'\r@x"`);
    });

    it('does not alter values that merely contain a trigger char mid-string', () => {
      expect(csvCell('Budget = $5M')).toBe('"Budget = $5M"');
      expect(csvCell('A-B Inc')).toBe('"A-B Inc"');
    });

    it('neutralizes a leading-dash value supplied as an untrusted string', () => {
      // A leading '-' is a formula trigger; the value is preserved but inert.
      expect(csvCell('-500')).toBe(`"'-500"`);
    });

    it('leaves a genuine negative NUMBER untouched (trusted, code-generated)', () => {
      // e.g. an overdue daysToDeadline of -5 must stay a real number.
      expect(csvCell(-500)).toBe('"-500"');
      expect(csvCell(-5)).toBe('"-5"');
    });
  });

  describe('RFC-4180 escaping', () => {
    it('quotes a plain string containing a comma', () => {
      expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    });

    it('doubles embedded quotes and preserves commas/newlines', () => {
      expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    });
  });
});

describe('slug', () => {
  it('lowercases and dashes a normal org name', () => {
    expect(slug('Horus Tech')).toBe('horus-tech');
  });

  it('collapses runs of non-alphanumeric chars to a single dash', () => {
    expect(slug('A & B Inc')).toBe('a-b-inc');
  });

  it('strips leading and trailing dashes', () => {
    expect(slug('--Acme--')).toBe('acme');
    expect(slug('.Acme.')).toBe('acme');
  });

  it('falls back to "export" when the slug is empty', () => {
    expect(slug('---')).toBe('export');
    expect(slug('')).toBe('export');
    expect(slug('   ')).toBe('export');
  });
});
