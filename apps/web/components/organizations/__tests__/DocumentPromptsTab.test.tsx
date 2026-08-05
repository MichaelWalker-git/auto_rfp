import { render, screen } from '@testing-library/react';
import { DocumentPromptsTab } from '../DocumentPromptsTab';
import type { DocumentPromptItem } from '@auto-rfp/core';
import { DocumentPromptTypeSchema, RFP_DOCUMENT_TYPES } from '@auto-rfp/core';

jest.mock('@/components/permission-wrapper', () => ({
  usePermission: () => true,
}));

const buildDefaults = (): DocumentPromptItem[] =>
  DocumentPromptTypeSchema.options.flatMap((documentType) => [
    { documentType, scope: 'SYSTEM' as const, prompt: `guidance ${documentType}`, isDefault: true },
    { documentType, scope: 'USER' as const, prompt: `task ${documentType}`, isDefault: true },
  ]);

describe('DocumentPromptsTab', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onReset = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders skeletons while loading', () => {
    const { container } = render(
      <DocumentPromptsTab documentPrompts={[]} isLoading isSaving={false} onSave={onSave} onReset={onReset}/>,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(/you are editing/i)).not.toBeInTheDocument();
  });

  it('shows the system-owned skeleton explainer', () => {
    render(
      <DocumentPromptsTab
        documentPrompts={buildDefaults()}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
        onReset={onReset}
      />,
    );

    expect(
      screen.getByText(/output format, template preservation, and tool rules are managed by the system/i),
    ).toBeInTheDocument();
  });

  it('renders a section per overridable document type with label and description', () => {
    render(
      <DocumentPromptsTab
        documentPrompts={buildDefaults()}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
        onReset={onReset}
      />,
    );

    for (const type of DocumentPromptTypeSchema.options) {
      expect(screen.getByText(RFP_DOCUMENT_TYPES[type])).toBeInTheDocument();
    }
    // 16 types × 2 scopes = 32 rows
    expect(screen.getAllByText('Guidance')).toHaveLength(DocumentPromptTypeSchema.options.length);
    expect(screen.getAllByText('Task instructions')).toHaveLength(DocumentPromptTypeSchema.options.length);
  });

  it('does not render non-overridable types like NDA or CLARIFYING_QUESTIONS', () => {
    render(
      <DocumentPromptsTab
        documentPrompts={buildDefaults()}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
        onReset={onReset}
      />,
    );

    expect(screen.queryByText(RFP_DOCUMENT_TYPES.NDA)).not.toBeInTheDocument();
    expect(screen.queryByText(RFP_DOCUMENT_TYPES.CLARIFYING_QUESTIONS)).not.toBeInTheDocument();
    expect(screen.queryByText(RFP_DOCUMENT_TYPES.EXECUTIVE_BRIEF)).not.toBeInTheDocument();
  });

  it('marks overridden rows as Customized and default rows as Default', () => {
    const items = buildDefaults().filter(
      (i) => !(i.documentType === 'COST_PROPOSAL' && i.scope === 'SYSTEM'),
    );
    items.push({
      documentType: 'COST_PROPOSAL',
      scope: 'SYSTEM',
      prompt: 'my custom guidance',
      orgId: 'org-1',
    });

    render(
      <DocumentPromptsTab
        documentPrompts={items}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
        onReset={onReset}
      />,
    );

    expect(screen.getAllByText('Customized')).toHaveLength(1);
    // remaining 31 rows are defaults
    expect(screen.getAllByText('Default')).toHaveLength(
      DocumentPromptTypeSchema.options.length * 2 - 1,
    );
  });
});
