import { render, screen, fireEvent } from '@testing-library/react';
import { FormSidebarTabs } from '../FormSidebarTabs';

describe('FormSidebarTabs', () => {
  it('renders Fields and History tabs and marks the active one', () => {
    render(<FormSidebarTabs value="fields" onChange={() => {}} />);
    const fields = screen.getByRole('button', { name: /fields/i });
    const history = screen.getByRole('button', { name: /history/i });
    expect(fields.getAttribute('aria-pressed')).toBe('true');
    expect(history.getAttribute('aria-pressed')).toBe('false');
  });

  it('fires onChange when a tab is clicked', () => {
    const onChange = jest.fn();
    render(<FormSidebarTabs value="fields" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('reflects history as active when selected', () => {
    render(<FormSidebarTabs value="history" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /history/i }).getAttribute('aria-pressed')).toBe('true');
  });
});
