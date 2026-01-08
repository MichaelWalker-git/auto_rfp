'use client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Download, Save, RefreshCw } from 'lucide-react';
import {
  GenerateProposalModal
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateProposalModal';
import PermissionWrapper from '@/components/permission-wrapper';

interface QuestionsHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSaveAll: () => void;
  onExport: () => void;
  unsavedCount: number;
  isSaving: boolean;
  projectId: string;
  onReload: () => void;
}

export function QuestionsHeader({
                                  searchQuery,
                                  onSearchChange,
                                  onSaveAll,
                                  onExport,
                                  unsavedCount,
                                  isSaving,
                                  projectId,
                                  onReload,
                                }: QuestionsHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">RFP Questions</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onReload}
            disabled={isSaving}
            aria-label="Reload questions"
            title="Reload questions"
          >
            {isSaving ? (
              <Spinner className="h-4 w-4"/>
            ) : (
              <RefreshCw className="h-4 w-4"/>
            )}
          </Button>
          <PermissionWrapper requiredPermission={'answer:edit'}>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={onSaveAll}
              disabled={unsavedCount === 0 || isSaving}
            >
              {isSaving ? (
                <>
                  <Spinner className="h-4 w-4"/>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4"/>
                  Save All
                </>
              )}
            </Button>
          </PermissionWrapper>
          <Button variant="outline" size="sm" className="gap-1" onClick={onExport}>
            <Download className="h-4 w-4"/>
            Export
          </Button>
          <GenerateProposalModal projectId={projectId}/>
        </div>
      </div>

      {unsavedCount > 0 && (
        <div className="text-sm text-amber-600 flex items-center justify-end">
          <span>{unsavedCount} question{unsavedCount > 1 ? 's' : ''} with unsaved changes</span>
        </div>
      )}
    </div>
  );
} 