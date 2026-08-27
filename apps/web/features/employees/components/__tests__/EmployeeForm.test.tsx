import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmployeeForm } from '../EmployeeForm';

const baseProps = {
  roleSuggestions: ['Project Manager'],
  onSubmit: jest.fn(),
  onCancel: jest.fn(),
  isSubmitting: false,
  submitLabel: 'Add employee',
};

describe('EmployeeForm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a field-level error for an empty name and preserves entered data (BR1.1, BR4.3)', async () => {
    render(<EmployeeForm {...baseProps} />);

    // Enter a role but leave the name empty
    const roleInput = screen
      .getByTestId('employee-form-primary-roles')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(roleInput, { target: { value: 'Project Manager' } });
    fireEvent.keyDown(roleInput, { key: 'Enter' });

    fireEvent.click(screen.getByTestId('employee-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('employee-form-name-error')).toBeInTheDocument();
    });
    expect(baseProps.onSubmit).not.toHaveBeenCalled();
    // Entered role survives the failed submit
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
  });

  it('submits parsed values on valid input (W2)', async () => {
    render(<EmployeeForm {...baseProps} />);

    fireEvent.change(screen.getByTestId('employee-form-name'), {
      target: { value: 'Jane Smith' },
    });
    fireEvent.click(screen.getByTestId('employee-form-submit'));

    await waitFor(() => {
      expect(baseProps.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Jane Smith',
          primaryRoles: [],
          secondaryRoles: [],
          certifications: [],
        }),
      );
    });
  });

  it('pre-fills values when editing (W3)', () => {
    render(
      <EmployeeForm
        {...baseProps}
        initialEmployee={{
          id: 'emp-1',
          orgId: 'org-1',
          name: 'Jane Smith',
          primaryRoles: ['Project Manager'],
          secondaryRoles: [],
          certifications: ['PMP'],
          location: 'ONSHORE',
          source: 'MANUAL',
        }}
        submitLabel="Save changes"
      />,
    );

    expect(screen.getByTestId('employee-form-name')).toHaveValue('Jane Smith');
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
    expect(screen.getByText('PMP')).toBeInTheDocument();
  });
});
