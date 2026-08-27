'use client';

import Link from 'next/link';
import { Sparkles, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EmployeeEmptyStateProps {
  orgId: string;
  /** Only managers see the creation actions (BR2.2). */
  canManage: boolean;
  /** Starts a generate-from-CVs import run (U2, BR1.2 manage-only). */
  onGenerate?: () => void;
  /** Disabled while a run is RUNNING or being triggered (BR1.1). */
  isGenerateDisabled?: boolean;
}

/**
 * Empty state that names BOTH creation paths (BR4.2): manual entry and the
 * AI generate-from-CVs import (U2).
 */
export const EmployeeEmptyState = ({
  orgId,
  canManage,
  onGenerate,
  isGenerateDisabled = false,
}: EmployeeEmptyStateProps) => (
  <div
    className="flex flex-col items-center gap-4 rounded-md border border-dashed p-12 text-center"
    data-testid="employee-empty-state"
  >
    <Users className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
    <div className="space-y-1">
      <h3 className="text-lg font-semibold">No employees yet</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Build your organization&apos;s employee pool by adding people manually, or generate it
        from CVs in your org documents.
      </p>
    </div>
    {canManage && (
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild data-testid="employee-empty-add">
          <Link href={`/organizations/${orgId}/employees/create`}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add employee
          </Link>
        </Button>
        <Button
          variant="outline"
          disabled={isGenerateDisabled || !onGenerate}
          onClick={onGenerate}
          data-testid="employee-empty-generate"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Generate from CVs
        </Button>
      </div>
    )}
  </div>
);
