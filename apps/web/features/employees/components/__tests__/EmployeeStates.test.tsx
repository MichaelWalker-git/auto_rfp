import { fireEvent, render, screen } from '@testing-library/react';
import { EmployeeTableSkeleton } from '../EmployeeTableSkeleton';
import { EmployeeEmptyState } from '../EmployeeEmptyState';
import { EmployeeErrorState } from '../EmployeeErrorState';

describe('EmployeeTableSkeleton', () => {
  it('renders skeleton placeholders while loading (BR4.2 — no spinners)', () => {
    render(<EmployeeTableSkeleton />);
    expect(screen.getByTestId('employee-table-skeleton')).toBeInTheDocument();
  });
});

describe('EmployeeEmptyState', () => {
  it('names BOTH creation paths for managers (BR4.2)', () => {
    render(<EmployeeEmptyState orgId="org-1" canManage />);

    expect(screen.getByTestId('employee-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('employee-empty-add')).toHaveTextContent('Add employee');
    expect(screen.getByTestId('employee-empty-generate')).toHaveTextContent('Generate from CVs');
  });

  it('hides creation actions from members without manage permission', () => {
    render(<EmployeeEmptyState orgId="org-1" canManage={false} />);

    expect(screen.queryByTestId('employee-empty-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('employee-empty-generate')).not.toBeInTheDocument();
  });
});

describe('EmployeeErrorState', () => {
  it('shows a plain-language message and triggers retry (BR4.2)', () => {
    const onRetry = jest.fn();
    render(<EmployeeErrorState onRetry={onRetry} />);

    expect(screen.getByTestId('employee-error-state')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('employee-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
