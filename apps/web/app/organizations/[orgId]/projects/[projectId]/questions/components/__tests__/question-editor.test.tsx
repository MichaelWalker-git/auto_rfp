import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionEditor } from '../question-editor';

// Mock the comment count hook — it fires SWR requests we don't care about here.
jest.mock('@/features/collaboration/hooks/useComments', () => ({
  useComments: () => ({ unresolvedCount: 0 }),
}));

// Grant all permissions so PermissionButton renders as a plain enabled button
// without needing the AuthProvider context.
jest.mock('@/components/permission-wrapper', () => ({
  usePermission: () => ({ hasPermission: true, isLoading: false }),
}));

// Mock heavy child components down to inert placeholders.
jest.mock('../similar-questions-panel', () => ({
  SimilarQuestionsPanel: () => null,
}));
jest.mock('@/features/collaboration', () => ({
  CollaborationPanel: () => null,
  FloatingPanel: () => null,
}));
jest.mock('@/components/confidence/confidence-score-display', () => ({
  ConfidenceScoreDisplay: () => null,
}));

const baseProps = {
  section: { title: 'Section A' },
  selectedIndexes: new Set<string>(),
  isUnsaved: false,
  isSaving: false,
  isGenerating: false,
  onAnswerChange: jest.fn(),
  onSave: jest.fn(),
  onApprove: jest.fn(),
  onGenerateAnswer: jest.fn(),
  onSourceClick: jest.fn(),
  onRemoveQuestion: jest.fn(),
};

const singleChoiceQuestion = {
  id: 'q1',
  question: 'Do you support AWS?',
  responseKind: 'SINGLE_CHOICE' as const,
  options: [{ label: 'Yes' }, { label: 'No' }],
};

const multiChoiceQuestion = {
  id: 'q2',
  question: 'Which clouds do you support?',
  responseKind: 'MULTI_CHOICE' as const,
  options: [{ label: 'AWS' }, { label: 'Azure' }, { label: 'GCP' }],
};

describe('QuestionEditor — choice questions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the fallback notice when a choice answer is unmatched prose', () => {
    render(
      <QuestionEditor
        {...baseProps}
        question={singleChoiceQuestion}
        answer={{ text: 'We use AWS for all production workloads.' }}
      />,
    );

    expect(
      screen.getByText(/doesn't match the available options/i),
    ).toBeInTheDocument();
    // The prose is shown so the user can see what would be replaced.
    expect(
      screen.getByText('We use AWS for all production workloads.'),
    ).toBeInTheDocument();
  });

  it('does not show the fallback notice when the answer matches an option', () => {
    render(
      <QuestionEditor
        {...baseProps}
        question={singleChoiceQuestion}
        answer={{ text: 'Yes' }}
      />,
    );

    expect(
      screen.queryByText(/doesn't match the available options/i),
    ).not.toBeInTheDocument();
  });

  it('selecting a radio option replaces the answer with the option label', async () => {
    const user = userEvent.setup();
    const onAnswerChange = jest.fn();
    render(
      <QuestionEditor
        {...baseProps}
        onAnswerChange={onAnswerChange}
        question={singleChoiceQuestion}
        answer={{ text: 'unmatched prose' }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(onAnswerChange).toHaveBeenCalledWith('Yes');
  });

  it('MULTI_CHOICE round-trips selected labels through the answer text', async () => {
    const user = userEvent.setup();
    const onAnswerChange = jest.fn();
    render(
      <QuestionEditor
        {...baseProps}
        onAnswerChange={onAnswerChange}
        question={multiChoiceQuestion}
        answer={{ text: 'AWS' }}
      />,
    );

    // AWS already checked; ticking GCP should preserve AWS and append GCP in
    // option order (AWS before GCP).
    await user.click(screen.getByRole('checkbox', { name: 'GCP' }));
    expect(onAnswerChange).toHaveBeenCalledWith('AWS\nGCP');
  });

  it('deselecting the only checked option clears the answer', async () => {
    const user = userEvent.setup();
    const onAnswerChange = jest.fn();
    render(
      <QuestionEditor
        {...baseProps}
        onAnswerChange={onAnswerChange}
        question={multiChoiceQuestion}
        answer={{ text: 'AWS' }}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'AWS' }));
    expect(onAnswerChange).toHaveBeenCalledWith('');
  });

  it('a MULTI_CHOICE toggle over unmatched prose replaces it rather than appending', async () => {
    const user = userEvent.setup();
    const onAnswerChange = jest.fn();
    render(
      <QuestionEditor
        {...baseProps}
        onAnswerChange={onAnswerChange}
        question={multiChoiceQuestion}
        answer={{ text: 'We use AWS and Azure in production.' }}
      />,
    );

    // No option boxes should read as checked while the text is unmatched prose.
    expect(screen.getByRole('checkbox', { name: 'AWS' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Azure' }));
    // The prose is discarded — only the freshly ticked option survives.
    expect(onAnswerChange).toHaveBeenCalledWith('Azure');
  });

  it('renders a textarea (not options) when responseKind is set but no options arrived', () => {
    render(
      <QuestionEditor
        {...baseProps}
        question={{ id: 'q3', question: 'Legacy?', responseKind: 'SINGLE_CHOICE', options: [] }}
        answer={{ text: 'freeform answer' }}
      />,
    );

    expect(screen.getByPlaceholderText(/Enter your answer here/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('disables the choice inputs when locked by another editor', () => {
    render(
      <QuestionEditor
        {...baseProps}
        question={multiChoiceQuestion}
        answer={{ text: 'AWS' }}
        collaboration={{
          orgId: 'org-1',
          editingUsers: [{ displayName: 'Alex' } as never],
        }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'AWS' })).toBeDisabled();
  });
});
