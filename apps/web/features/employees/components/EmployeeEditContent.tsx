'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useEmployee } from '../hooks/useEmployee';
import { useUpdateEmployee } from '../hooks/useEmployeeMutations';
import { useRoleSuggestions } from '../hooks/useRoleSuggestions';
import { EmployeeForm, type EmployeeFormOutput } from './EmployeeForm';
import { EmployeeErrorState } from './EmployeeErrorState';

const EditFormSkeleton = () => (
  <div className="space-y-6" data-testid="employee-edit-skeleton">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    ))}
  </div>
);

/** Dedicated edit view (W3) — values pre-filled, same validation as create. */
export const EmployeeEditContent = ({ orgId, employeeId }: { orgId: string; employeeId: string }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { employee, isLoading, notFound, error, refresh } = useEmployee(orgId, employeeId);
  const { updateEmployee, isUpdating } = useUpdateEmployee(orgId, employeeId);
  const roleSuggestions = useRoleSuggestions(orgId);

  const listUrl = `/organizations/${orgId}/employees`;

  const handleSubmit = async (values: EmployeeFormOutput) => {
    try {
      const res = await updateEmployee(values);
      toast({ title: 'Employee updated', description: `${res.item.name} was saved.` });
      router.push(listUrl);
    } catch {
      toast({
        title: 'Update failed',
        description: 'The changes could not be saved. Check the fields and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-6">
      <PageHeader title="Edit employee" description="Update this person's roles and details." />
      {isLoading ? (
        <EditFormSkeleton />
      ) : notFound ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="employee-edit-not-found">
          This employee no longer exists. They may have been removed from the pool.
        </p>
      ) : error ? (
        <EmployeeErrorState onRetry={() => void refresh()} />
      ) : employee ? (
        <EmployeeForm
          initialEmployee={employee}
          roleSuggestions={roleSuggestions}
          onSubmit={handleSubmit}
          onCancel={() => router.push(listUrl)}
          isSubmitting={isUpdating}
          submitLabel="Save changes"
        />
      ) : null}
    </div>
  );
};
