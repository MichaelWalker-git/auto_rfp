import { fireEvent, render, screen } from '@testing-library/react';
import { EmployeeTable } from '../EmployeeTable';
import type { EmployeeListItem } from '@auto-rfp/core';

const employees: EmployeeListItem[] = [
  {
    id: 'emp-1',
    orgId: 'org-1',
    name: 'Jane Smith',
    primaryRoles: ['Project Manager'],
    secondaryRoles: ['Scrum Master'],
    certifications: ['PMP', 'CSM'],
    location: 'ONSHORE',
  },
  {
    id: 'emp-2',
    orgId: 'org-1',
    name: 'John Doe',
    primaryRoles: ['Developer'],
    secondaryRoles: [],
    certifications: [],
  },
];

const baseProps = {
  employees,
  orgId: 'org-1',
  sort: { field: 'name', direction: 'asc' } as const,
  onSortChange: jest.fn(),
  onDeleteRequest: jest.fn(),
};

describe('EmployeeTable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders a row per employee with roles, location, and certification count', () => {
    render(<EmployeeTable {...baseProps} canManage />);

    expect(screen.getByTestId('employee-table')).toBeInTheDocument();
    expect(screen.getByTestId('employee-row-emp-1')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
    expect(screen.getByText('ONSHORE')).toBeInTheDocument();
    expect(screen.getByTestId('employee-cert-count-emp-1')).toHaveTextContent('2');
    expect(screen.getByTestId('employee-cert-count-emp-2')).toHaveTextContent('0');
  });

  it('reports sort changes when a header is clicked (BR4.1)', () => {
    render(<EmployeeTable {...baseProps} canManage />);

    // Same field flips direction
    fireEvent.click(screen.getByTestId('employee-table-sort-name'));
    expect(baseProps.onSortChange).toHaveBeenCalledWith({ field: 'name', direction: 'desc' });

    // A different field starts ascending
    fireEvent.click(screen.getByTestId('employee-table-sort-location'));
    expect(baseProps.onSortChange).toHaveBeenCalledWith({ field: 'location', direction: 'asc' });
  });

  it('hides mutating actions from members without manage permission (BR2.1/BR2.2)', () => {
    render(<EmployeeTable {...baseProps} canManage={false} />);

    expect(screen.queryByTestId('employee-edit-emp-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('employee-delete-emp-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('employee-name-link-emp-1')).not.toBeInTheDocument();
  });

  it('asks for delete confirmation via the callback (dialog owns the snapshot copy)', () => {
    render(<EmployeeTable {...baseProps} canManage />);

    fireEvent.click(screen.getByTestId('employee-delete-emp-1'));
    expect(baseProps.onDeleteRequest).toHaveBeenCalledWith(employees[0]);
  });
});
