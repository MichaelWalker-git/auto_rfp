import { render, screen, fireEvent } from '@testing-library/react';
import { AceStageSelect } from '../AceStageSelect';

// Radix Select needs pointer-events APIs jsdom doesn't implement.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.hasPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => jest.clearAllMocks());

describe('AceStageSelect', () => {
  it('renders the placeholder when no stage is set', () => {
    render(<AceStageSelect value={undefined} syncError={null} onChange={jest.fn()} />);
    expect(screen.getByText('ACE stage')).toBeTruthy();
  });

  it('shows the current stage value', () => {
    render(<AceStageSelect value="Qualified" syncError={null} onChange={jest.fn()} />);
    expect(screen.getByRole('combobox', { name: /ace stage/i }).textContent).toContain('Qualified');
  });

  it('lists all 7 ACE stages when opened', () => {
    render(<AceStageSelect value={undefined} syncError={null} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('combobox', { name: /ace stage/i }));

    const stages = [
      'Prospect',
      'Qualified',
      'Technical Validation',
      'Business Validation',
      'Committed',
      'Launched',
      'Closed Lost',
    ];
    stages.forEach((stage) => {
      expect(screen.getByRole('option', { name: stage })).toBeTruthy();
    });
  });

  it('calls onChange with the selected stage', () => {
    const handleChange = jest.fn();
    render(<AceStageSelect value="Prospect" syncError={null} onChange={handleChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: /ace stage/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Technical Validation' }));
    expect(handleChange).toHaveBeenCalledWith('Technical Validation');
  });

  it('is disabled while a change is pending', () => {
    render(<AceStageSelect value="Prospect" syncError={null} disabled onChange={jest.fn()} />);
    const trigger = screen.getByRole('combobox', { name: /ace stage/i });
    expect(trigger.hasAttribute('disabled')).toBe(true);
  });

  it('shows a sync-error badge when the last Partner Central push failed', () => {
    render(<AceStageSelect value="Prospect" syncError="AccessDenied" onChange={jest.fn()} />);
    expect(screen.getByText('ACE')).toBeTruthy();
  });

  it('shows no error badge when the sync succeeded', () => {
    render(<AceStageSelect value="Prospect" syncError={null} onChange={jest.fn()} />);
    expect(screen.queryByText('ACE')).toBeNull();
  });
});
