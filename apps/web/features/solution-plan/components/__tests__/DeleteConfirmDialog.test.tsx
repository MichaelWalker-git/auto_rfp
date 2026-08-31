import { fireEvent, render, screen } from '@testing-library/react';
import { DeleteConfirmDialog } from '../DeleteConfirmDialog';
import { DELETE_CURRENT_MESSAGE } from '../../lib/version-errors';
import { makeVersion } from '../../hooks/__tests__/test-utils';

const version = makeVersion({ versionId: 'ver-1', label: 'Old draft' });

const setup = (over: Partial<React.ComponentProps<typeof DeleteConfirmDialog>> = {}) => {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    version,
    isDeleting: false,
    errorMessage: null,
    onConfirm: jest.fn(),
    ...over,
  };
  render(<DeleteConfirmDialog {...props} />);
  return props;
};

describe('DeleteConfirmDialog', () => {
  it('names the version and warns the delete cannot be undone', () => {
    setup();

    expect(screen.getByText('Delete this version?')).toBeTruthy();
    expect(screen.getByText(/old draft/i)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  });

  it('gives Cancel the initial focus (W6 step 1)', () => {
    setup();

    expect(document.activeElement).toBe(screen.getByTestId('delete-cancel'));
  });

  it('marks the destructive action by icon + wording, not color alone', () => {
    setup();

    const confirm = screen.getByTestId('delete-confirm');
    expect(confirm).toHaveTextContent('Delete version');
    expect(confirm.querySelector('svg')).toBeTruthy();
  });

  it('fires onConfirm and stays open (the container closes on success)', () => {
    const { onConfirm, onOpenChange } = setup();

    fireEvent.click(screen.getByTestId('delete-confirm'));

    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables both controls while the delete is in flight', () => {
    setup({ isDeleting: true });

    expect(screen.getByTestId('delete-confirm')).toBeDisabled();
    expect(screen.getByTestId('delete-cancel')).toBeDisabled();
  });

  it('shows the specific mapped failure message inline (current-version conflict)', () => {
    setup({ errorMessage: DELETE_CURRENT_MESSAGE });

    expect(screen.getByTestId('delete-error')).toHaveTextContent(DELETE_CURRENT_MESSAGE);
  });
});
