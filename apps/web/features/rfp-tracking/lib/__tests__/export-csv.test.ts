import { exportPipelineToCsv } from '../export-csv';
import { makeItem } from '../../__tests__/fixtures';

const NOW = '2026-07-27T00:00:00.000Z';

// Capture the CSV text that gets wrapped in a Blob so we can assert on content.
let lastBlobText = '';
let lastDownloadName = '';

beforeEach(() => {
  lastBlobText = '';
  lastDownloadName = '';

  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();

  // Blob in jsdom doesn't expose text() synchronously; stash the parts instead.
  global.Blob = jest.fn((parts: string[]) => {
    lastBlobText = parts.join('');
    return { size: lastBlobText.length } as unknown as Blob;
  }) as unknown as typeof Blob;

  // Intercept the anchor so click() doesn't try to navigate in jsdom.
  jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'a') {
      const anchor = {
        set href(_v: string) {},
        set download(v: string) {
          lastDownloadName = v;
        },
        click: jest.fn(),
      };
      return anchor as unknown as HTMLElement;
    }
    return {} as HTMLElement;
  }) as typeof document.createElement);

  jest.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
  jest.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
});

afterEach(() => jest.restoreAllMocks());

describe('exportPipelineToCsv', () => {
  it('writes a header row plus one row per item', () => {
    const items = [
      makeItem({ id: 'a', title: 'Alpha', status: 'PURSUING' }),
      makeItem({ id: 'b', title: 'Beta', status: 'QUALIFYING' }),
    ];
    exportPipelineToCsv(items, 'Acme Corp', NOW);

    const lines = lastBlobText.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toContain('Title');
    expect(lines[1]).toContain('Alpha');
    expect(lines[2]).toContain('Beta');
  });

  it('includes an Approval column with the approval label', () => {
    const items = [makeItem({ id: 'a', title: 'Alpha', approvalStatus: 'I_APPROVED' })];
    exportPipelineToCsv(items, 'Acme Corp', NOW);
    const lines = lastBlobText.split('\n');
    expect(lines[0]).toContain('Approval');
    expect(lines[1]).toContain('I Approved');
  });

  it('escapes embedded quotes by doubling them', () => {
    const items = [makeItem({ title: 'The "Big" RFP' })];
    exportPipelineToCsv(items, 'Acme', NOW);
    expect(lastBlobText).toContain('"The ""Big"" RFP"');
  });

  it('neutralizes formula injection in a Linear-synced title', () => {
    const items = [makeItem({ title: '=HYPERLINK("http://evil.example","click")' })];
    exportPipelineToCsv(items, 'Acme', NOW);
    // Leading '=' is defused with a single-quote prefix so spreadsheets treat it as text.
    expect(lastBlobText).toContain(`"'=HYPERLINK(`);
    expect(lastBlobText).not.toContain('"=HYPERLINK(');
  });

  it('keeps an overdue (negative) daysToDeadline as a real number, not formula-escaped text', () => {
    // Deadline two days before NOW → daysToDeadline of -2. The raw number must
    // reach csvCell (not a pre-stringified "-2"), so it stays "-2" not '-2.
    const items = [makeItem({ id: 'a', title: 'Overdue', responseDeadlineIso: '2026-07-25T00:00:00.000Z' })];
    exportPipelineToCsv(items, 'Acme', NOW);
    expect(lastBlobText).toContain('"-2"');
    expect(lastBlobText).not.toContain(`"'-2"`);
  });

  it('slugifies the org name into the download filename', () => {
    exportPipelineToCsv([makeItem()], 'Acme Corp', NOW);
    expect(lastDownloadName).toBe('rfp-pipeline-acme-corp.csv');
  });

  it('collapses runs of non-alphanumeric characters to single dashes', () => {
    exportPipelineToCsv([makeItem()], 'A & B Inc', NOW);
    expect(lastDownloadName).toBe('rfp-pipeline-a-b-inc.csv');
  });

  it('revokes the object URL after triggering the download', () => {
    exportPipelineToCsv([makeItem()], 'Acme', NOW);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
