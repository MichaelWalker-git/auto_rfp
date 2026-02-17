'use client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Download, Save, RefreshCw } from 'lucide-react';
import PermissionWrapper from '@/components/permission-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';

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
  onReload,
}: QuestionsHeaderProps) {
  return (
    <div className="space-y-2">
      <PageHeader
        title="RFP Questions"
        description={unsavedCount > 0 ? `${unsavedCount} question${unsavedCount > 1 ? 's' : ''} with unsaved changes` : undefined}
        actions={
          <>
            <PageSearch
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search questions..."
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onReload}
              disabled={isSaving}
              aria-label="Reload questions"
              title="Reload questions"
            >
              {isSaving ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <PermissionWrapper requiredPermission="answer:edit">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={onSaveAll}
                disabled={unsavedCount === 0 || isSaving}
              >
                {isSaving ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save All
                  </>
                )}
              </Button>
            </PermissionWrapper>
            <Button variant="outline" size="sm" className="gap-1" onClick={onExport}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          </>
        }
      />
    </div>
  );
}
