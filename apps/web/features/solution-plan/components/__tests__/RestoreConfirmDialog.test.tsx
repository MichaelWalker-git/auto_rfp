import { fireEvent, render, screen } from '@testing-library/react';
import { RestoreConfirmDialog } from '../RestoreConfirmDialog';
import { RESTORE_GENERATING_MESSAGE } from '../../lib/version-errors';
import { makeVersion } from '../../hooks/__tests__/test-utils';

const version = makeVersion({ versionId: 'ver-1', label: 'Final review' });

const setup = (over: Partial<React.ComponentProps<typeof RestoreConfirmDialog>> = {}) => {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    version,
    isRestoring: false,
    errorMessage: null,
    onConfirm: jest.fn(),
    ...over,
  };
  render(<RestoreConfirmDialog {...props} />);
  return props;
};

describe('RestoreConfirmDialog', () => {
  it('names the version and explains the current plan is preserved', () => {
    setup();

    expect(screen.getByText('Restore this version?')).toBeTruthy();
    expect(screen.getByText(/final review/i)).toBeTruthy();
    expect(screen.getByText(/current plan is preserved/i)).toBeTruthy();
  });

  it('gives Cancel the initial focus (W4 step 1)', () => {
    setup();

    expect(document.activeElement).toBe(screen.getByTestId('restore-cancel'));
  });

  it('marks the primary action by wording + icon, not color alone', () => {
    setup();

    const confirm = screen.getByTestId('restore-confirm');
    expect(confirm).toHaveTextContent('Restore version');
    expect(confirm.querySelector('svg')).toBeTruthy();
  });

  it('fires onConfirm and stays open (the container closes on success)', () => {
    const { onConfirm, onOpenChange } = setup();

    fireEvent.click(screen.getByTestId('restore-confirm'));

    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables both controls while the restore is in flight', () => {
    setup({ isRestoring: true });

    expect(screen.getByTestId('restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('restore-cancel')).toBeDisabled();
  });

  it('shows the specific mapped failure message inline', () => {
    setup({ errorMessage: RESTORE_GENERATING_MESSAGE });

    expect(screen.getByTestId('restore-error')).toHaveTextContent(RESTORE_GENERATING_MESSAGE);
  });

  it('does not close while a restore is in flight', () => {
    const { onOpenChange } = setup({ isRestoring: true });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
