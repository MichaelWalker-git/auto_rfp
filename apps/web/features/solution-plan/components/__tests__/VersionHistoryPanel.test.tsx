import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SYSTEM_CREATED_BY, SYSTEM_CREATED_BY_NAME } from '@auto-rfp/core';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import { VERSION_LIST_ERROR_MESSAGE, VersionHistoryPanel } from '../VersionHistoryPanel';
import { makeVersion } from '../../hooks/__tests__/test-utils';

// Radix menus need these DOM APIs that jsdom doesn't ship.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.hasPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
});

const versions: SolutionPlanVersionListItem[] = [
  makeVersion({
    versionId: 'ver-3',
    versionNumber: 3,
    origin: 'restore',
    label: 'A very long label that will definitely be truncated in the row display',
    createdByName: 'Jane Doe',
    createdAt: '2026-08-27T10:00:00.000Z',
  }),
  makeVersion({
    versionId: 'ver-2',
    versionNumber: 2,
    origin: 'generation',
    createdBy: SYSTEM_CREATED_BY,
    createdByName: SYSTEM_CREATED_BY_NAME,
    createdAt: '2026-08-26T10:00:00.000Z',
  }),
];

const setup = (over: Partial<React.ComponentProps<typeof VersionHistoryPanel>> = {}) => {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    versions,
    currentVersionId: 'ver-3',
    isLoading: false,
    hasError: false,
    onRetry: jest.fn(),
    isRestoreDisabled: false,
    onView: jest.fn(),
    onRestore: jest.fn(),
    onDelete: jest.fn(),
    onSaveLabel: jest.fn().mockResolvedValue({ outcome: 'saved' }),
    ...over,
  };
  render(<VersionHistoryPanel {...props} />);
  return props;
};

const openRowMenu = (versionId: string) => {
  fireEvent.keyDown(screen.getByTestId(`version-row-actions-${versionId}`), { key: 'Enter' });
};

describe('VersionHistoryPanel', () => {
  it('shows skeleton rows while loading — never "Loading..." text', () => {
    setup({ versions: [], isLoading: true });

    expect(screen.getByTestId('version-list-skeleton')).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it('renders rows with origin, creator (including "System"), label, and Current badge', () => {
    setup();

    const currentRow = screen.getByTestId('version-row-ver-3');
    expect(currentRow).toHaveTextContent('Current');
    expect(currentRow).toHaveTextContent('Restore');
    expect(currentRow).toHaveTextContent('Jane Doe');

    const systemRow = screen.getByTestId('version-row-ver-2');
    expect(systemRow).toHaveTextContent(SYSTEM_CREATED_BY_NAME);
    expect(systemRow).toHaveTextContent('Generation');
    expect(systemRow).not.toHaveTextContent('Current');
  });

  it('exposes the full label on hover/focus via the title attribute', () => {
    setup();

    const label = screen.getByTestId('version-row-label-ver-3');
    expect(label).toHaveAttribute(
      'title',
      'A very long label that will definitely be truncated in the row display',
    );
  });

  it('offers View/Restore…/Rename/Delete… on non-current rows', () => {
    setup();

    openRowMenu('ver-2');

    expect(screen.getByTestId('version-row-view-ver-2')).toBeTruthy();
    expect(screen.getByTestId('version-row-restore-ver-2')).toBeTruthy();
    expect(screen.getByTestId('version-row-rename-ver-2')).toBeTruthy();
    expect(screen.getByTestId('version-row-delete-ver-2')).toBeTruthy();
  });

  it('offers only View and Rename label on the current row', () => {
    setup();

    openRowMenu('ver-3');

    expect(screen.getByTestId('version-row-view-ver-3')).toBeTruthy();
    expect(screen.getByTestId('version-row-rename-ver-3')).toBeTruthy();
    expect(screen.queryByTestId('version-row-restore-ver-3')).toBeNull();
    expect(screen.queryByTestId('version-row-delete-ver-3')).toBeNull();
  });

  it('disables Restore… while the plan is generating (W4 step 4)', () => {
    setup({ isRestoreDisabled: true });

    openRowMenu('ver-2');

    expect(screen.getByTestId('version-row-restore-ver-2')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('fires the row action callbacks', () => {
    const { onView, onRestore, onDelete } = setup();

    openRowMenu('ver-2');
    fireEvent.click(screen.getByTestId('version-row-view-ver-2'));
    expect(onView).toHaveBeenCalledWith('ver-2');

    openRowMenu('ver-2');
    fireEvent.click(screen.getByTestId('version-row-restore-ver-2'));
    expect(onRestore).toHaveBeenCalledWith('ver-2');

    openRowMenu('ver-2');
    fireEvent.click(screen.getByTestId('version-row-delete-ver-2'));
    expect(onDelete).toHaveBeenCalledWith('ver-2');
  });

  it('opens the inline label editor from Rename label and saves through the callback', async () => {
    const { onSaveLabel } = setup();

    openRowMenu('ver-2');
    fireEvent.click(screen.getByTestId('version-row-rename-ver-2'));

    const input = await screen.findByTestId('version-label-input');
    fireEvent.change(input, { target: { value: 'Compliance pass' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSaveLabel).toHaveBeenCalledWith('ver-2', 'Compliance pass'));
    await waitFor(() => expect(screen.queryByTestId('version-label-input')).toBeNull());
  });

  it('explains automatic versioning when the history is empty', () => {
    setup({ versions: [] });

    expect(screen.getByTestId('version-list-empty')).toHaveTextContent(/no versions yet/i);
  });

  it('shows a plain-language error with Retry on load failure', () => {
    const { onRetry } = setup({ versions: [], hasError: true });

    expect(screen.getByText(VERSION_LIST_ERROR_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByTestId('version-list-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
