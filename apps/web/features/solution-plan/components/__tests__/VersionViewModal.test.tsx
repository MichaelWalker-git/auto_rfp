import { fireEvent, render, screen } from '@testing-library/react';
import { VERSION_CONTENT_ERROR_MESSAGE, VersionViewModal } from '../VersionViewModal';
import { VERSION_NOT_FOUND_MESSAGE } from '../../lib/version-errors';
import { makeVersion } from '../../hooks/__tests__/test-utils';

// TipTap is too heavy for jsdom — a read-only stand-in preserving the
// value/disabled contract the modal relies on (the plan's own renderer).
jest.mock('@/components/rfp-documents/rich-text-editor', () => ({
  RichTextEditor: ({ value, disabled }: { value: string; disabled?: boolean }) => (
    <div data-testid="rich-text-editor" data-disabled={disabled}>
      {value}
    </div>
  ),
}));

const mockSanitize = jest.fn((html: string) => `sanitized:${html}`);
jest.mock('@/components/rfp-documents/rfp-document-utils', () => ({
  sanitizeGeneratedHtml: (html: string) => mockSanitize(html),
}));

const version = makeVersion({ versionId: 'ver-2', label: 'Final review' });

const setup = (over: Partial<React.ComponentProps<typeof VersionViewModal>> = {}) => {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    version,
    html: '<h1>Old body</h1>',
    isLoading: false,
    hasError: false,
    notFound: false,
    onRetry: jest.fn(),
    isCurrent: false,
    isRestoreDisabled: false,
    onRestore: jest.fn(),
    onDelete: jest.fn(),
    onSaveLabel: jest.fn().mockResolvedValue({ outcome: 'saved' }),
    ...over,
  };
  render(<VersionViewModal {...props} />);
  return props;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VersionViewModal', () => {
  it('shows a skeleton body while the content loads — never "Loading..." text', () => {
    setup({ html: null, isLoading: true });

    expect(screen.getByTestId('version-view-skeleton')).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it('renders the version through the plan renderer read-only under a naming banner', () => {
    setup();

    expect(screen.getByTestId('version-view-banner')).toHaveTextContent(/read-only/i);
    expect(screen.getByTestId('version-view-banner')).toHaveTextContent(/final review/i);

    const renderer = screen.getByTestId('rich-text-editor');
    expect(renderer).toHaveAttribute('data-disabled', 'true');
    expect(renderer).toHaveTextContent('sanitized:<h1>Old body</h1>');
    expect(mockSanitize).toHaveBeenCalledWith('<h1>Old body</h1>');
  });

  it('shows a plain-language error with retry and a disabled Restore on load failure', () => {
    const { onRetry } = setup({ html: null, hasError: true });

    expect(screen.getByText(VERSION_CONTENT_ERROR_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('version-view-restore')).toBeDisabled();
    fireEvent.click(screen.getByTestId('version-view-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows the vanished-version message when the version no longer exists', () => {
    setup({ html: null, notFound: true });

    expect(screen.getByTestId('version-view-not-found')).toHaveTextContent(
      VERSION_NOT_FOUND_MESSAGE,
    );
    expect(screen.getByTestId('version-view-restore')).toBeDisabled();
  });

  it('offers Rename label, Delete…, Close, and Restore… on a non-current version', () => {
    const { onRestore, onDelete } = setup();

    fireEvent.click(screen.getByTestId('version-view-restore'));
    expect(onRestore).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('version-view-delete'));
    expect(onDelete).toHaveBeenCalled();
    expect(screen.getByTestId('version-view-close')).toBeTruthy();
    expect(screen.getByTestId('version-view-rename')).toBeTruthy();
  });

  it('offers only Rename label + Close for the current version', () => {
    setup({ isCurrent: true });

    expect(screen.getByTestId('version-view-rename')).toBeTruthy();
    expect(screen.getByTestId('version-view-close')).toBeTruthy();
    expect(screen.queryByTestId('version-view-restore')).toBeNull();
    expect(screen.queryByTestId('version-view-delete')).toBeNull();
  });

  it('disables Restore… while the plan is generating', () => {
    setup({ isRestoreDisabled: true });

    expect(screen.getByTestId('version-view-restore')).toBeDisabled();
  });

  it('opens the inline label editor from the footer and saves through the callback', async () => {
    const { onSaveLabel } = setup();

    fireEvent.click(screen.getByTestId('version-view-rename'));
    const input = await screen.findByTestId('version-label-input');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveLabel).toHaveBeenCalledWith('Renamed');
  });

  it('closes via the Close button', () => {
    const { onOpenChange } = setup();

    fireEvent.click(screen.getByTestId('version-view-close'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
