import React from 'react';
import { render } from '@testing-library/react';
import { TabBar } from '../TabBar';

describe('TabBar', () => {
  it('renders without crashing', () => {
    const tabs = [
      { id: 'details', label: 'Details', icon: 'info' },
      { id: 'analysis', label: 'Analysis', icon: 'chart' },
      { id: 'documents', label: 'Output Documents', icon: 'document' },
      { id: 'submission', label: 'Submission', icon: 'submit' },
      { id: 'result', label: 'Result', icon: 'result' },
      { id: 'foia', label: 'FOIA', icon: 'foia' },
    ];

    const { container } = render(<TabBar tabs={tabs} activeTab="details" />);
    expect(container).toBeInTheDocument();
  });

  it('renders tabs with correct labels', () => {
    const tabs = [
      { id: 'details', label: 'Details', icon: 'info' },
      { id: 'analysis', label: 'Analysis', icon: 'chart' },
    ];

    const { getByText } = render(<TabBar tabs={tabs} activeTab="details" />);
    expect(getByText('Details')).toBeInTheDocument();
    expect(getByText('Analysis')).toBeInTheDocument();
  });
});