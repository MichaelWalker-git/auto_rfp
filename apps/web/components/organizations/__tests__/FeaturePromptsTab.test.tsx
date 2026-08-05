import { render, screen } from '@testing-library/react';
import { FeaturePromptsTab } from '../FeaturePromptsTab';
import type { PromptItem } from '@auto-rfp/core';

const mockUsePermission = jest.fn((_permission: string) => true);
jest.mock('@/components/permission-wrapper', () => ({
  usePermission: (permission: string) => mockUsePermission(permission),
}));

const item = (type: PromptItem['type'], scope: 'SYSTEM' | 'USER'): PromptItem => ({
  type,
  scope,
  prompt: `${scope} prompt for ${type}`,
  params: [],
});

describe('FeaturePromptsTab', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePermission.mockReturnValue(true);
  });

  it('renders skeletons while loading', () => {
    const { container } = render(
      <FeaturePromptsTab system={[]} user={[]} isLoading isSaving={false} onSave={onSave}/>,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no prompts', () => {
    render(
      <FeaturePromptsTab system={[]} user={[]} isLoading={false} isSaving={false} onSave={onSave}/>,
    );

    expect(screen.getByText(/no prompts yet/i)).toBeInTheDocument();
  });

  it('renders sections for regular feature types', () => {
    render(
      <FeaturePromptsTab
        system={[item('ANSWER', 'SYSTEM'), item('SUMMARY', 'SYSTEM')]}
        user={[item('ANSWER', 'USER')]}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
      />,
    );

    expect(screen.getAllByText('ANSWER').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SUMMARY').length).toBeGreaterThan(0);
  });

  it('filters out dead types RFP_DOCUMENT, PROPOSAL and TECHNICAL_PROPOSAL', () => {
    render(
      <FeaturePromptsTab
        system={[
          item('RFP_DOCUMENT', 'SYSTEM'),
          item('PROPOSAL', 'SYSTEM'),
          item('TECHNICAL_PROPOSAL', 'SYSTEM'),
          item('ANSWER', 'SYSTEM'),
        ]}
        user={[item('RFP_DOCUMENT', 'USER')]}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
      />,
    );

    expect(screen.getAllByText('ANSWER').length).toBeGreaterThan(0);
    expect(screen.queryByText('RFP_DOCUMENT')).not.toBeInTheDocument();
    expect(screen.queryByText('PROPOSAL')).not.toBeInTheDocument();
    expect(screen.queryByText('TECHNICAL_PROPOSAL')).not.toBeInTheDocument();
  });

  it('gates save buttons on prompt:create', () => {
    mockUsePermission.mockImplementation(() => false);
    render(
      <FeaturePromptsTab
        system={[item('ANSWER', 'SYSTEM')]}
        user={[]}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
      />,
    );

    expect(mockUsePermission).toHaveBeenCalledWith('prompt:create');
    for (const button of screen.getAllByRole('button', { name: /save/i })) {
      expect(button).toBeDisabled();
    }
  });
});
