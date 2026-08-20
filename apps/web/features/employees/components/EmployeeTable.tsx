'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EmployeeListItem } from '@auto-rfp/core';

export type EmployeeSortField = 'name' | 'primaryRoles' | 'secondaryRoles' | 'location' | 'certifications';

export interface EmployeeSortDescriptor {
  field: EmployeeSortField;
  direction: 'asc' | 'desc';
}

export interface EmployeeTableProps {
  employees: EmployeeListItem[];
  orgId: string;
  sort: EmployeeSortDescriptor;
  onSortChange: (sort: EmployeeSortDescriptor) => void;
  /** Managers see mutating actions; members get the read-only surface (BR2.1/BR2.2). */
  canManage: boolean;
  onDeleteRequest: (employee: EmployeeListItem) => void;
}

const SORTABLE_COLUMNS: Array<{ field: EmployeeSortField; label: string }> = [
  { field: 'name', label: 'Name' },
  { field: 'primaryRoles', label: 'Primary roles' },
  { field: 'secondaryRoles', label: 'Secondary roles' },
  { field: 'location', label: 'Location' },
  { field: 'certifications', label: 'Certifications' },
];

const RoleBadges = ({ roles, testId }: { roles: string[]; testId: string }) => {
  if (roles.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-xs flex-wrap gap-1" data-testid={testId}>
      {roles.map((role) => (
        <Badge key={role} variant="secondary" className="max-w-full">
          <span className="truncate">{role}</span>
        </Badge>
      ))}
    </div>
  );
};

/**
 * Presentation-only sortable employee table (BR4.1). Long names and many
 * roles wrap/truncate without breaking the layout (BR4.2 edge state).
 */
export const EmployeeTable = ({
  employees,
  orgId,
  sort,
  onSortChange,
  canManage,
  onDeleteRequest,
}: EmployeeTableProps) => {
  const handleSortClick = (field: EmployeeSortField) => {
    onSortChange({
      field,
      direction: sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  const sortIcon = (field: EmployeeSortField) => {
    if (sort.field !== field) return <ArrowUpDown className="ml-1 h-3.5 w-3.5" />;
    return sort.direction === 'asc' ? (
      <ArrowUp className="ml-1 h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="ml-1 h-3.5 w-3.5" />
    );
  };

  return (
    <div className="rounded-md border">
      <Table data-testid="employee-table">
        <TableHeader>
          <TableRow>
            {SORTABLE_COLUMNS.map(({ field, label }) => (
              <TableHead key={field}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-8"
                  data-testid={`employee-table-sort-${field}`}
                  aria-sort={
                    sort.field === field
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  onClick={() => handleSortClick(field)}
                >
                  {label}
                  {sortIcon(field)}
                </Button>
              </TableHead>
            ))}
            {canManage && <TableHead className="w-24 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((employee) => (
            <TableRow key={employee.id} data-testid={`employee-row-${employee.id}`}>
              <TableCell className="max-w-xs font-medium">
                {canManage ? (
                  <Link
                    href={`/organizations/${orgId}/employees/${employee.id}/edit`}
                    className="block truncate hover:underline"
                    data-testid={`employee-name-link-${employee.id}`}
                  >
                    {employee.name}
                  </Link>
                ) : (
                  <span className="block truncate">{employee.name}</span>
                )}
              </TableCell>
              <TableCell>
                <RoleBadges roles={employee.primaryRoles} testId={`employee-primary-roles-${employee.id}`} />
              </TableCell>
              <TableCell>
                <RoleBadges roles={employee.secondaryRoles} testId={`employee-secondary-roles-${employee.id}`} />
              </TableCell>
              <TableCell>
                {employee.location ? (
                  <Badge variant="outline">{employee.location}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell data-testid={`employee-cert-count-${employee.id}`}>
                {employee.certifications.length}
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                      aria-label={`Edit ${employee.name}`}
                      data-testid={`employee-edit-${employee.id}`}
                    >
                      <Link href={`/organizations/${orgId}/employees/${employee.id}/edit`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${employee.name}`}
                      data-testid={`employee-delete-${employee.id}`}
                      onClick={() => onDeleteRequest(employee)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
