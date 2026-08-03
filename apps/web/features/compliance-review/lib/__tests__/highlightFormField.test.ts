import {
  highlightFieldById,
  highlightCellByCoords,
  highlightFormSnippet,
  parseHighlightCell,
  FIELD_LOCATOR_ATTR,
  CELL_LOCATOR_ATTR,
} from '../highlightFormField';

// jsdom doesn't implement scrollTo / scrollIntoView, getBoundingClientRect (all
// zeros), or requestAnimationFrame reliably. Stub them so the overlay-based
// flash can run: give the target a non-zero rect (so sync() keeps the overlay)
// and make rAF a no-op (we assert the overlay is appended synchronously).
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollTo = jest.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.getBoundingClientRect = jest.fn(
    () => ({ top: 10, left: 10, width: 100, height: 20, right: 110, bottom: 30, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect,
  );
  global.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  global.cancelAnimationFrame = (() => {}) as unknown as typeof cancelAnimationFrame;
});

/** The overlay flashHighlight appends to <body> (fixed-position highlight box). */
const overlayEls = () => document.querySelectorAll('[data-compliance-highlight]');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('parseHighlightCell', () => {
  it('parses sheet,row,col', () => {
    expect(parseHighlightCell('Pricing,4,2')).toEqual({ sheet: 'Pricing', row: 4, col: 2 });
  });

  it('keeps commas inside the sheet name (splits from the right)', () => {
    expect(parseHighlightCell('Cost, Volume,10,3')).toEqual({ sheet: 'Cost, Volume', row: 10, col: 3 });
  });

  it('returns null for null / malformed input', () => {
    expect(parseHighlightCell(null)).toBeNull();
    expect(parseHighlightCell('')).toBeNull();
    expect(parseHighlightCell('Sheet1')).toBeNull();
    expect(parseHighlightCell('Sheet,x,2')).toBeNull();
    expect(parseHighlightCell(',1,2')).toBeNull();
  });
});

describe('highlightFieldById', () => {
  it('finds the PDF overlay by #field-<id> and flashes it', () => {
    const el = document.createElement('div');
    el.id = 'field-abc';
    document.body.appendChild(el);
    expect(highlightFieldById('abc')).toBe(true);
    expect(overlayEls().length).toBeGreaterThan(0);
  });

  it('falls back to the XLSX locator attribute', () => {
    const el = document.createElement('div');
    el.setAttribute(FIELD_LOCATOR_ATTR, 'xyz');
    document.body.appendChild(el);
    expect(highlightFieldById('xyz')).toBe(true);
    expect(overlayEls().length).toBeGreaterThan(0);
  });

  it('escapes ids with quotes/special chars in the attribute selector', () => {
    const el = document.createElement('div');
    const weird = 'field "9"';
    el.setAttribute(FIELD_LOCATOR_ATTR, weird);
    document.body.appendChild(el);
    expect(highlightFieldById(weird)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(highlightFieldById('missing')).toBe(false);
  });
});

describe('highlightCellByCoords', () => {
  it('finds a cell by its row,col locator', () => {
    const td = document.createElement('td');
    td.setAttribute(CELL_LOCATOR_ATTR, '4,2');
    document.body.appendChild(td);
    expect(highlightCellByCoords(4, 2)).toBe(true);
    expect(overlayEls().length).toBeGreaterThan(0);
  });

  it('returns false when the cell is absent', () => {
    expect(highlightCellByCoords(1, 1)).toBe(false);
  });
});

describe('highlightFormSnippet', () => {
  it('matches text case-insensitively and whitespace-tolerantly', () => {
    const p = document.createElement('p');
    p.textContent = 'The  Offeror   SHALL provide';
    document.body.appendChild(p);
    expect(highlightFormSnippet('the offeror shall')).toBe(true);
    expect(overlayEls().length).toBeGreaterThan(0);
  });

  it('returns false for an empty snippet or no match', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(highlightFormSnippet('   ')).toBe(false);
    expect(highlightFormSnippet('absent phrase')).toBe(false);
  });

  it('scopes the search to a provided container', () => {
    document.body.innerHTML = '<div id="a">outside</div><div id="b"><span>inside target</span></div>';
    const container = document.getElementById('a');
    expect(highlightFormSnippet('inside target', container)).toBe(false);
  });
});
