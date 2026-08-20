'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { useToast } from '@/components/ui/use-toast';
import { useCreateEmployee } from '../hooks/useEmployeeMutations';
import { useRoleSuggestions } from '../hooks/useRoleSuggestions';
import { EmployeeForm, type EmployeeFormOutput } from './EmployeeForm';

/** Dedicated create view (W2, BR4.3 — a separate route, not a dialog). */
export const EmployeeCreateContent = ({ orgId }: { orgId: string }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { createEmployee, isCreating } = useCreateEmployee(orgId);
  const roleSuggestions = useRoleSuggestions(orgId);

  const listUrl = `/organizations/${orgId}/employees`;

  const handleSubmit = async (values: EmployeeFormOutput) => {
    try {
      const res = await createEmployee(values);
      toast({ title: 'Employee added', description: `${res.item.name} joined the pool.` });
      router.push(listUrl);
    } catch {
      toast({
        title: 'Create failed',
        description: 'The employee could not be saved. Check the fields and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-6">
      <PageHeader
        title="Add employee"
        description="Create a member of your organization's employee pool."
      />
      <EmployeeForm
        roleSuggestions={roleSuggestions}
        onSubmit={handleSubmit}
        onCancel={() => router.push(listUrl)}
        isSubmitting={isCreating}
        submitLabel="Add employee"
      />
    </div>
  );
};
