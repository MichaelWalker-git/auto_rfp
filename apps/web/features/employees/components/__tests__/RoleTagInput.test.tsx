import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { RoleTagInput } from '../RoleTagInput';

const ControlledInput = ({ suggestions = [] as string[] }) => {
  const [value, setValue] = useState<string[]>([]);
  return <RoleTagInput value={value} onChange={setValue} suggestions={suggestions} />;
};

describe('RoleTagInput', () => {
  it('accepts free text on Enter even when it matches no suggestion (BR1.5)', () => {
    render(<ControlledInput suggestions={['Project Manager']} />);

    const input = screen.getByTestId('role-tag-input-input');
    fireEvent.change(input, { target: { value: 'Underwater Basket Weaver' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Underwater Basket Weaver')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('offers labor-rate position suggestions filtered by the typed text (BR1.5)', () => {
    render(<ControlledInput suggestions={['Project Manager', 'Developer', 'Designer']} />);

    const input = screen.getByTestId('role-tag-input-input');
    fireEvent.change(input, { target: { value: 'de' } });

    const list = screen.getByTestId('role-tag-input-suggestions');
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId('role-tag-input-suggestion-Developer')).toBeInTheDocument();
    expect(screen.getByTestId('role-tag-input-suggestion-Designer')).toBeInTheDocument();
    expect(screen.queryByTestId('role-tag-input-suggestion-Project Manager')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('role-tag-input-suggestion-Developer'));
    expect(screen.getByTestId('role-tag-input-tags')).toHaveTextContent('Developer');
  });

  it('commits pending typed text on blur so click-away or Save does not lose it', () => {
    render(<ControlledInput />);

    const input = screen.getByTestId('role-tag-input-input');
    fireEvent.change(input, { target: { value: 'PMP' } });
    // No Enter — the user clicks straight onto the submit button.
    fireEvent.blur(input);

    expect(screen.getByTestId('role-tag-input-tags')).toHaveTextContent('PMP');
    expect(input).toHaveValue('');
  });

  it('does not duplicate an existing entry committed via blur', () => {
    render(<ControlledInput />);

    const input = screen.getByTestId('role-tag-input-input');
    fireEvent.change(input, { target: { value: 'PMP' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'PMP' } });
    fireEvent.blur(input);

    expect(screen.getAllByText('PMP')).toHaveLength(1);
    expect(input).toHaveValue('');
  });

  it('removes an entry via its remove button', () => {
    render(<ControlledInput />);

    const input = screen.getByTestId('role-tag-input-input');
    fireEvent.change(input, { target: { value: 'PM' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('PM')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('role-tag-input-remove-PM'));
    expect(screen.queryByText('PM')).not.toBeInTheDocument();
  });
});
