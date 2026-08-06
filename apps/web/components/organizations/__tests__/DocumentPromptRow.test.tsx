import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentPromptRow } from '../DocumentPromptRow';
import type { DocumentPromptItem } from '@auto-rfp/core';
import { DOCUMENT_PROMPT_MAX_LENGTH } from '@auto-rfp/core';

const mockUsePermission = jest.fn((_permission: string) => true);
jest.mock('@/components/permission-wrapper', () => ({
  usePermission: (permission: string) => mockUsePermission(permission),
}));

const defaultItem: DocumentPromptItem = {
  documentType: 'COST_PROPOSAL',
  scope: 'SYSTEM',
  prompt: 'Default guidance text',
  isDefault: true,
};

const customizedItem: DocumentPromptItem = {
  documentType: 'COST_PROPOSAL',
  scope: 'SYSTEM',
  prompt: 'Custom guidance text',
  orgId: 'org-1',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DocumentPromptRow', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onReset = jest.fn().mockResolvedValue(undefined);

  const renderRow = (current: DocumentPromptItem | null) =>
    render(
      <DocumentPromptRow
        scope="SYSTEM"
        documentType="COST_PROPOSAL"
        current={current}
        onSave={onSave}
        onReset={onReset}
        isSaving={false}
      />,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePermission.mockReturnValue(true);
  });

  it('shows Default badge and no reset button for a default prompt', () => {
    renderRow(defaultItem);

    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.queryByText('Customized')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
  });

  it('shows Customized badge and reset button for an org override', () => {
    renderRow(customizedItem);

    expect(screen.getByText('Customized')).toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeInTheDocument();
  });

  it('pre-fills the textarea with the default text', async () => {
    const user = userEvent.setup();
    renderRow(defaultItem);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByRole('textbox')).toHaveValue('Default guidance text');
  });

  it('labels SYSTEM scope as Guidance', () => {
    renderRow(defaultItem);
    expect(screen.getByText('Guidance')).toBeInTheDocument();
  });

  it('labels USER scope as Task instructions', () => {
    render(
      <DocumentPromptRow
        scope="USER"
        documentType="COST_PROPOSAL"
        current={{ ...defaultItem, scope: 'USER' }}
        onSave={onSave}
        onReset={onReset}
        isSaving={false}
      />,
    );
    expect(screen.getByText('Task instructions')).toBeInTheDocument();
  });

  it('disables save until the text is changed, then calls onSave', async () => {
    const user = userEvent.setup();
    renderRow(defaultItem);

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.type(screen.getByRole('textbox'), ' more');

    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(onSave).toHaveBeenCalledWith({
      scope: 'SYSTEM',
      documentType: 'COST_PROPOSAL',
      prompt: 'Default guidance text more',
    });
  });

  it('shows the char counter with the 8,000 limit and disables save when over it', async () => {
    const user = userEvent.setup();
    renderRow(customizedItem);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByText(/8,000 chars/)).toBeInTheDocument();

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    // paste an over-limit value directly (typing 8k chars is too slow)
    const oversized = 'x'.repeat(DOCUMENT_PROMPT_MAX_LENGTH + 1);
    await user.clear(textarea);
    await user.click(textarea);
    await user.paste(oversized);

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('disables save when the text is empty', async () => {
    const user = userEvent.setup();
    renderRow(customizedItem);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByRole('textbox'));

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onReset when the reset button is clicked', async () => {
    const user = userEvent.setup();
    renderRow(customizedItem);

    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    expect(onReset).toHaveBeenCalledWith({ scope: 'SYSTEM', documentType: 'COST_PROPOSAL' });
  });

  it('gates save on prompt:create and reset on prompt:delete', () => {
    mockUsePermission.mockImplementation(() => false);
    renderRow(customizedItem);

    expect(mockUsePermission).toHaveBeenCalledWith('prompt:create');
    expect(mockUsePermission).toHaveBeenCalledWith('prompt:delete');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeDisabled();
  });

  it('does not show a Runtime params panel', async () => {
    const user = userEvent.setup();
    renderRow(defaultItem);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.queryByText(/runtime params/i)).not.toBeInTheDocument();
  });
});
