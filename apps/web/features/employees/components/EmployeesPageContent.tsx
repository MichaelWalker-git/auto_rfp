'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { Sparkles, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PermissionButton } from '@/components/ui/permission-button';
import { usePermission } from '@/components/permission-wrapper';
import { useToast } from '@/components/ui/use-toast';
import type { EmployeeItem, EmployeeListItem } from '@auto-rfp/core';
import { useEmployees } from '../hooks/useEmployees';
import { useDeleteEmployee } from '../hooks/useEmployeeMutations';
import { useEmployeeImport } from '../hooks/useEmployeeImport';
import { ImportProgressBanner } from './ImportProgressBanner';
import { ImportResultBanner } from './ImportResultBanner';
import {
  EmployeeTable,
  type EmployeeSortDescriptor,
  type EmployeeSortField,
} from './EmployeeTable';
import { EmployeeTableSkeleton } from './EmployeeTableSkeleton';
import { EmployeeEmptyState } from './EmployeeEmptyState';
import { EmployeeErrorState } from './EmployeeErrorState';

const SORT_FIELDS = ['name', 'primaryRoles', 'secondaryRoles', 'location', 'certifications'] as const;
const LOCATION_FILTERS = ['ALL', 'ONSHORE', 'OFFSHORE'] as const;

const sortValue = (employee: EmployeeItem, field: EmployeeSortField): string | number => {
  switch (field) {
    case 'name':
      return employee.name.toLowerCase();
    case 'primaryRoles':
      return (employee.primaryRoles[0] ?? '').toLowerCase();
    case 'secondaryRoles':
      return (employee.secondaryRoles[0] ?? '').toLowerCase();
    case 'location':
      return employee.location ?? '';
    case 'certifications':
      return employee.certifications.length;
  }
};

/**
 * The org-level Employees page container (W1). Search/filter/sort live in URL
 * state (BR4.1); the five screen states follow BR4.2. Managers see mutating
 * actions, members get the read-only surface (BR2.1/BR2.2).
 */
export const EmployeesPageContent = ({ orgId }: { orgId: string }) => {
  const { employees, isLoading, error, refresh } = useEmployees(orgId);
  const { deleteEmployee, isDeleting } = useDeleteEmployee(orgId);
  const { run: importRun, isRunning: isImportRunning, triggerImport, isTriggering } =
    useEmployeeImport(orgId);
  const canManage = usePermission('employee:manage');
  const { toast } = useToast();

  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);

  const handleGenerateFromCvs = async () => {
    try {
      await triggerImport();
      toast({
        title: 'Import started',
        description: 'Scanning your org documents for CVs. Progress is shown above the table.',
      });
    } catch (err) {
      const isConflict = (err as { status?: number })?.status === 409;
      toast({
        title: isConflict ? 'Import already running' : 'Import could not start',
        description: isConflict
          ? 'An employee import is already in progress for this organization. Wait for it to finish.'
          : 'Something went wrong starting the import. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const showResultBanner =
    !!importRun &&
    importRun.status !== 'RUNNING' &&
    importRun.importRunId !== dismissedRunId;

  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [locationFilter, setLocationFilter] = useQueryState(
    'location',
    parseAsStringLiteral(LOCATION_FILTERS).withDefault('ALL'),
  );
  const [sortField, setSortField] = useQueryState(
    'sort',
    parseAsStringLiteral(SORT_FIELDS).withDefault('name'),
  );
  const [sortDir, setSortDir] = useQueryState(
    'dir',
    parseAsStringLiteral(['asc', 'desc'] as const).withDefault('asc'),
  );

  const [deleteTarget, setDeleteTarget] = useState<EmployeeListItem | null>(null);

  const sort: EmployeeSortDescriptor = { field: sortField, direction: sortDir };

  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = employees.filter((employee) => {
      if (locationFilter !== 'ALL' && employee.location !== locationFilter) return false;
      if (!query) return true;
      const haystack = [
        employee.name,
        ...employee.primaryRoles,
        ...employee.secondaryRoles,
        ...employee.certifications,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [employees, search, locationFilter, sortField, sortDir]);

  const handleSortChange = (next: EmployeeSortDescriptor) => {
    void setSortField(next.field);
    void setSortDir(next.direction);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEmployee({ id: deleteTarget.id });
      toast({ title: 'Employee deleted', description: `${deleteTarget.name} was removed from the pool.` });
    } catch {
      toast({
        title: 'Delete failed',
        description: 'The employee could not be deleted. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const isEmpty = !isLoading && !error && employees.length === 0;
  const isFilteredEmpty = !isLoading && !error && employees.length > 0 && visibleEmployees.length === 0;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title="Employees"
        description="Your organization's delivery workforce — reference data for team assembly and proposals."
        actions={
          <div className="flex gap-2">
            <PermissionButton
              requiredPermission="employee:manage"
              variant="outline"
              disabled={isImportRunning || isTriggering}
              tooltip={
                isImportRunning
                  ? 'An import is already running — progress is shown below'
                  : 'Scan org documents for CVs and generate the employee list'
              }
              onClick={handleGenerateFromCvs}
              data-testid="employees-generate-from-cvs"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate from CVs
            </PermissionButton>
            <PermissionButton
              requiredPermission="employee:manage"
              asChild
              data-testid="employees-add"
            >
              <Link href={`/organizations/${orgId}/employees/create`}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add employee
              </Link>
            </PermissionButton>
          </div>
        }
      />

      {isImportRunning && importRun && <ImportProgressBanner run={importRun} />}
      {showResultBanner && importRun && (
        <ImportResultBanner
          run={importRun}
          onDismiss={() => setDismissedRunId(importRun.importRunId)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => void setSearch(e.target.value)}
          placeholder="Search by name, role, or certification…"
          className="max-w-sm"
          aria-label="Search employees"
          data-testid="employees-search"
        />
        <Select
          value={locationFilter}
          onValueChange={(value) => void setLocationFilter(value as (typeof LOCATION_FILTERS)[number])}
        >
          <SelectTrigger className="w-40" aria-label="Filter by location" data-testid="employees-location-filter">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All locations</SelectItem>
            <SelectItem value="ONSHORE">Onshore</SelectItem>
            <SelectItem value="OFFSHORE">Offshore</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <EmployeeTableSkeleton />
      ) : error ? (
        <EmployeeErrorState onRetry={() => void refresh()} />
      ) : isEmpty ? (
        <EmployeeEmptyState
          orgId={orgId}
          canManage={canManage}
          onGenerate={handleGenerateFromCvs}
          isGenerateDisabled={isImportRunning || isTriggering}
        />
      ) : isFilteredEmpty ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="employees-no-matches">
          No employees match your search or filters.
        </p>
      ) : (
        <EmployeeTable
          employees={visibleEmployees}
          orgId={orgId}
          sort={sort}
          onSortChange={handleSortChange}
          canManage={canManage}
          onDeleteRequest={setDeleteTarget}
        />
      )}

      <ConfirmDeleteDialog
        isOpen={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
        itemName={deleteTarget?.name}
        itemType="employee"
        title="Delete employee?"
        description={
          deleteTarget
            ? `${deleteTarget.name} will be removed from the employee pool. Saved solution-plan teams keep this person's name as a snapshot and mark the line as referencing a removed employee.`
            : undefined
        }
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
