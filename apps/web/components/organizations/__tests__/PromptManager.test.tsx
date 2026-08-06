import * as React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptsManager } from '../PromptManager';
import type { DocumentPromptItem, PromptItem } from '@auto-rfp/core';

// nuqs ships ESM only (not transformed by jest) — mock useQueryState with plain
// React state seeded from a per-test initial value.
let initialTab: string | null = null;
jest.mock('nuqs', () => ({
  parseAsStringLiteral: (values: readonly string[]) => ({
    withDefault: (defaultValue: string) => ({ values, defaultValue }),
  }),
  useQueryState: (_key: string, parser: { values: readonly string[]; defaultValue: string }) => {
    const seed =
      initialTab && parser.values.includes(initialTab) ? initialTab : parser.defaultValue;
    return React.useState<string>(seed);
  },
}));

jest.mock('@/components/permission-wrapper', () => ({
  usePermission: () => true,
}));

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ currentOrganization: { id: 'org-1', name: 'Org One' } }),
}));

jest.mock('@/components/organizations/CreatePromptDialog', () => ({
  CreatePromptDialog: () => <button type="button">New prompt</button>,
}));

const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockSaveTrigger = jest.fn().mockResolvedValue({});
const mockDeleteTrigger = jest.fn().mockResolvedValue(true);

const featureItem: PromptItem = {
  type: 'ANSWER',
  scope: 'SYSTEM',
  prompt: 'answer system prompt',
  params: [],
};

const documentItems: DocumentPromptItem[] = [
  { documentType: 'COST_PROPOSAL', scope: 'SYSTEM', prompt: 'guidance', isDefault: true },
  { documentType: 'COST_PROPOSAL', scope: 'USER', prompt: 'custom task', orgId: 'org-1' },
];

interface UsePromptsResult {
  system: PromptItem[];
  user: PromptItem[];
  document: DocumentPromptItem[];
  isLoading: boolean;
  error: Error | null;
  refresh: jest.Mock;
}

const mockUsePrompts = jest.fn(
  (_orgId?: string): UsePromptsResult => ({
    system: [featureItem],
    user: [],
    document: documentItems,
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  }),
);

jest.mock('@/lib/hooks/use-prompt', () => ({
  usePrompts: (orgId?: string) => mockUsePrompts(orgId),
  useSavePrompt: () => ({ trigger: mockSaveTrigger, isMutating: false }),
  useDeletePrompt: () => ({ trigger: mockDeleteTrigger, isMutating: false }),
}));

const renderManager = (tab: string | null = null) => {
  initialTab = tab;
  return render(<PromptsManager/>);
};

describe('PromptsManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initialTab = null;
  });

  it('renders both tabs with AI Features active by default', () => {
    renderManager();

    expect(screen.getByRole('tab', { name: 'AI Features' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Document Generation' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByText('ANSWER').length).toBeGreaterThan(0);
  });

  it('opens the Document Generation tab from ?tab=documents', () => {
    renderManager('documents');

    expect(screen.getByRole('tab', { name: 'Document Generation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/you are editing the document-type guidance/i)).toBeInTheDocument();
  });

  it('switches to the Document Generation tab on click', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('tab', { name: 'Document Generation' }));

    expect(screen.getByRole('tab', { name: 'Document Generation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/you are editing the document-type guidance/i)).toBeInTheDocument();
  });

  it('shows the New prompt action only on the AI Features tab', async () => {
    const user = userEvent.setup();
    renderManager();

    expect(screen.getByRole('button', { name: 'New prompt' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Document Generation' }));

    expect(screen.queryByRole('button', { name: 'New prompt' })).not.toBeInTheDocument();
  });

  it('resets a customized document prompt after confirmation', async () => {
    const user = userEvent.setup();
    renderManager('documents');

    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    // confirm dialog appears
    expect(await screen.findByText('Reset to default?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(mockDeleteTrigger).toHaveBeenCalledWith({
        scope: 'USER',
        documentType: 'COST_PROPOSAL',
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('does not delete when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderManager('documents');

    await user.click(screen.getByRole('button', { name: /reset to default/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(mockDeleteTrigger).not.toHaveBeenCalled();
  });

  it('saves a document prompt override with orgId', async () => {
    const user = userEvent.setup();
    renderManager('documents');

    // the customized USER row is the only one with a Customized badge — scope to it
    const customizedRow = screen.getByText('Customized').closest('div.rounded-2xl') as HTMLElement;
    await user.click(within(customizedRow).getByRole('button', { name: /edit/i }));

    const textarea = within(customizedRow).getByRole('textbox');
    await user.type(textarea, ' updated');
    await user.click(within(customizedRow).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockSaveTrigger).toHaveBeenCalledWith({
        scope: 'USER',
        documentType: 'COST_PROPOSAL',
        prompt: 'custom task updated',
        orgId: 'org-1',
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('surfaces load errors via toast', () => {
    mockUsePrompts.mockReturnValueOnce({
      system: [],
      user: [],
      document: [],
      isLoading: false,
      error: new Error('boom'),
      refresh: mockRefresh,
    });

    renderManager();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to load prompts', variant: 'destructive' }),
    );
  });
});
