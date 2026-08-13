import { render, screen } from '@testing-library/react';
import { GrillingTranscriptView } from '../GrillingTranscriptView';
import type { GrillingMessageListItem } from '@auto-rfp/core';

const msg = (over: Partial<GrillingMessageListItem>): GrillingMessageListItem => ({
  id: Math.random().toString(),
  round: 1,
  role: 'GRILLER',
  content: 'What is the expected concurrent user load?',
  ...over,
});

describe('GrillingTranscriptView', () => {
  it('shows skeletons while loading with no messages yet', () => {
    render(<GrillingTranscriptView messages={[]} isLoading />);
    expect(screen.getByTestId('transcript-skeleton')).toBeTruthy();
  });

  it('shows a waiting message when loaded but empty', () => {
    render(<GrillingTranscriptView messages={[]} />);
    expect(
      screen.getByText('The interview is starting — the first question will appear here shortly.'),
    ).toBeTruthy();
  });

  it('labels griller and tech lead messages', () => {
    render(
      <GrillingTranscriptView
        messages={[
          msg({ role: 'GRILLER', content: 'How many users?' }),
          msg({ role: 'TECH_LEAD', content: 'About 500 concurrent.' }),
        ]}
      />,
    );
    expect(screen.getByText('Interviewer')).toBeTruthy();
    expect(screen.getByText('Tech Lead')).toBeTruthy();
    expect(screen.getByText('How many users?')).toBeTruthy();
    expect(screen.getByText('About 500 concurrent.')).toBeTruthy();
  });

  it('renders one round separator per round', () => {
    render(
      <GrillingTranscriptView
        messages={[
          msg({ round: 1, role: 'GRILLER' }),
          msg({ round: 1, role: 'TECH_LEAD', content: 'Answer one.' }),
          msg({ round: 2, role: 'GRILLER', content: 'Second question?' }),
        ]}
      />,
    );
    expect(screen.getAllByText('Round 1')).toHaveLength(1);
    expect(screen.getAllByText('Round 2')).toHaveLength(1);
  });

  it('renders system messages as muted notes', () => {
    render(<GrillingTranscriptView messages={[msg({ role: 'SYSTEM', content: 'Interview complete.' })]} />);
    expect(screen.getByText('Interview complete.')).toBeTruthy();
    expect(screen.queryByText('Interviewer')).toBeNull();
  });

  it('shows tool call chips on tech lead messages', () => {
    render(
      <GrillingTranscriptView
        messages={[
          msg({
            role: 'TECH_LEAD',
            content: 'Checked the KB.',
            toolCalls: [
              { toolName: 'search_knowledge_base', summary: 'query: load' },
              { toolName: 'get_pricing_data' },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('search_knowledge_base')).toBeTruthy();
    expect(screen.getByText('get_pricing_data')).toBeTruthy();
  });
});
