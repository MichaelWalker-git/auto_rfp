import { norm, escapeRegex, tokens, containsWord, dollarRegex, personNameRegex } from './compliance-review-text';

describe('norm', () => {
  it('collapses whitespace runs and trims', () => {
    expect(norm('  a\t b\n\n c  ')).toBe('a b c');
  });
});

describe('escapeRegex', () => {
  it('escapes regex metacharacters so a literal matches as text', () => {
    const escaped = escapeRegex('a.b*c(d)');
    expect(new RegExp(escaped).test('a.b*c(d)')).toBe(true);
    // The dot must be literal, not "any char".
    expect(new RegExp(escaped).test('aXb*c(d)')).toBe(false);
  });
});

describe('tokens', () => {
  it('returns distinct-position lowercase words ≥3 chars', () => {
    expect(tokens('The Big-Red FOX, a 2!')).toEqual(['the', 'big', 'red', 'fox']);
  });
});

describe('containsWord', () => {
  it('matches whole words only, case-insensitive by default', () => {
    expect(containsWord('the ceiling is high', 'ein')).toBe(false); // inside "ceiling"
    expect(containsWord('EIN 12-3456789', 'ein')).toBe(true);
  });

  it('case-sensitive mode separates an uppercase acronym from the lowercase word', () => {
    expect(containsWord('the cage was open', 'CAGE', true)).toBe(false);
    expect(containsWord('CAGE 1ABC5', 'CAGE', true)).toBe(true);
  });

  it('returns false for an empty needle', () => {
    expect(containsWord('anything', '   ')).toBe(false);
  });
});

describe('dollarRegex', () => {
  it('matches common dollar formats (callers trim the trailing space the suffix slot allows)', () => {
    expect('costs $1,200,000 total'.match(dollarRegex())?.[0].trim()).toBe('$1,200,000');
    expect('about $1.2M annually'.match(dollarRegex())?.[0].trim()).toBe('$1.2M');
    expect('$500K budget'.match(dollarRegex())?.[0].trim()).toBe('$500K');
  });

  it('returns a FRESH instance each call (no shared lastIndex state)', () => {
    const a = dollarRegex();
    const b = dollarRegex();
    expect(a).not.toBe(b);
    // Exhausting one global regex must not affect the other.
    a.exec('$5 and $6');
    a.exec('$5 and $6');
    expect(b.lastIndex).toBe(0);
  });
});

describe('personNameRegex', () => {
  it('matches First Last and First M. Last name shapes', () => {
    expect('led by Jane Doe on site'.match(personNameRegex())).toContain('Jane Doe');
    expect('contact Robert A. Jones today'.match(personNameRegex())).toContain('Robert A. Jones');
  });

  it('does not match a single capitalized word or an all-lowercase phrase', () => {
    expect('the project manager coordinates'.match(personNameRegex())).toBeNull();
    expect('Manager'.match(personNameRegex())).toBeNull();
  });

  it('returns a FRESH instance each call (no shared lastIndex state)', () => {
    const a = personNameRegex();
    const b = personNameRegex();
    expect(a).not.toBe(b);
    expect(b.lastIndex).toBe(0);
  });
});
