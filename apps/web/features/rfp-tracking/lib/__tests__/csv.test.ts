import { csvCell } from '../csv';

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
      ['+1+1', `"'+1+1"`],
      ['-2+3', `"'-2+3"`],
      ['@SUM(A1:A9)', `"'@SUM(A1:A9)"`],
      ['\tcmd', `"'\tcmd"`],
    ])('prefixes a single quote to values starting with a formula trigger: %s', (input, expected) => {
      expect(csvCell(input)).toBe(expected);
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
    });
  });
});
