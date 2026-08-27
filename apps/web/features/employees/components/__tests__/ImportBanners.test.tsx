import { fireEvent, render, screen } from '@testing-library/react';
import type { EmployeeImportRunItem } from '@auto-rfp/core';
import { ImportProgressBanner } from '../ImportProgressBanner';
import { ImportResultBanner } from '../ImportResultBanner';
import { EmployeeEmptyState } from '../EmployeeEmptyState';

const makeRun = (overrides: Partial<EmployeeImportRunItem> = {}): EmployeeImportRunItem => ({
  importRunId: 'run-1',
  orgId: 'org-1',
  status: 'RUNNING',
  documentsScanned: 7,
  cvsDetected: 3,
  employeesCreated: 2,
  employeesUpdated: 1,
  certificationDocsDetected: 0,
  certificationsMapped: 0,
  failedDocuments: [],
  triggeredBy: 'user-1',
  startedAt: '2026-08-19T10:00:00.000Z',
  ...overrides,
});

describe('ImportProgressBanner', () => {
  it('renders live progress counts with a polite live region (BR5.1, NFR4)', () => {
    render(<ImportProgressBanner run={makeRun()} />);

    const banner = screen.getByTestId('import-progress-banner');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    const counts = screen.getByTestId('import-progress-counts');
    expect(counts).toHaveTextContent('7 documents scanned');
    expect(counts).toHaveTextContent('3 CVs detected');
    expect(counts).toHaveTextContent('2 employees added');
    expect(counts).toHaveTextContent('1 updated');
  });
});

describe('ImportResultBanner', () => {
  it('names every failed document with a plain-language reason (BR4.1, Q2)', () => {
    render(
      <ImportResultBanner
        run={makeRun({
          status: 'COMPLETED_WITH_ERRORS',
          completedAt: '2026-08-19T10:05:00.000Z',
          failedDocuments: [
            { documentName: 'scan-old.pdf', reason: 'UNREADABLE' },
            { documentName: 'anon-cv.docx', reason: 'INCOMPLETE_EXTRACTION' },
            { documentName: 'dup-cv.pdf', reason: 'AMBIGUOUS_NAME' },
          ],
        })}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId('import-result-counts')).toHaveTextContent('2 employees added');
    const items = screen.getAllByTestId('import-failed-doc');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('scan-old.pdf');
    expect(items[0]).toHaveTextContent("couldn't be read");
    expect(items[1]).toHaveTextContent("didn't yield a person's name");
    expect(items[2]).toHaveTextContent('more than one existing employee');
  });

  it('reports certificate documents and mapped certifications, with the UNMATCHED_PERSON reason', () => {
    render(
      <ImportResultBanner
        run={makeRun({
          status: 'COMPLETED_WITH_ERRORS',
          completedAt: '2026-08-19T10:05:00.000Z',
          certificationDocsDetected: 3,
          certificationsMapped: 2,
          failedDocuments: [{ documentName: 'stranger-cert.pdf', reason: 'UNMATCHED_PERSON' }],
        })}
        onDismiss={jest.fn()}
      />,
    );

    const counts = screen.getByTestId('import-result-counts');
    expect(counts).toHaveTextContent('3 certificate documents detected');
    expect(counts).toHaveTextContent('2 certifications mapped to employees');
    const items = screen.getAllByTestId('import-failed-doc');
    expect(items[0]).toHaveTextContent('stranger-cert.pdf');
    expect(items[0]).toHaveTextContent("names a person who isn't in the employee pool");
  });

  it('hides the certificate segment when no certificate documents were detected (older runs)', () => {
    render(
      <ImportResultBanner
        run={makeRun({ status: 'COMPLETED', completedAt: '2026-08-19T10:05:00.000Z' })}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.getByTestId('import-result-counts')).not.toHaveTextContent('certificate');
  });

  it('is dismissible', () => {
    const onDismiss = jest.fn();
    render(
      <ImportResultBanner
        run={makeRun({ status: 'COMPLETED', completedAt: '2026-08-19T10:05:00.000Z' })}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByTestId('import-result-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('explains a FAILED run and that partial imports are preserved (BR4.2)', () => {
    render(
      <ImportResultBanner
        run={makeRun({ status: 'FAILED', documentsScanned: 5, employeesCreated: 1 })}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId('import-result-banner')).toHaveTextContent(
      'Employee import stopped early',
    );
    expect(screen.getByTestId('import-result-counts')).toHaveTextContent(
      'Everything imported so far has been kept',
    );
  });
});

describe('EmployeeEmptyState — generate-from-CVs (U2)', () => {
  it('triggers the import for managers and disables while a run is in flight (BR1.1)', () => {
    const onGenerate = jest.fn();
    const { rerender } = render(
      <EmployeeEmptyState orgId="org-1" canManage onGenerate={onGenerate} />,
    );

    const button = screen.getByTestId('employee-empty-generate');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);

    rerender(
      <EmployeeEmptyState orgId="org-1" canManage onGenerate={onGenerate} isGenerateDisabled />,
    );
    expect(screen.getByTestId('employee-empty-generate')).toBeDisabled();
  });

  it('stays hidden from members without manage permission (BR1.2)', () => {
    render(<EmployeeEmptyState orgId="org-1" canManage={false} onGenerate={jest.fn()} />);
    expect(screen.queryByTestId('employee-empty-generate')).not.toBeInTheDocument();
  });
});
