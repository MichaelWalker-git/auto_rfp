'use client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Download, CheckCheck, RefreshCw, FileSpreadsheet, FileText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import PermissionWrapper from '@/components/permission-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';
import { PresenceAvatars, usePresence } from '@/features/collaboration';
import { useQuestions } from './questions-provider';

interface QuestionsHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onApproveAll: () => void;
  onExportCsv: () => void;
  onExportDocx: () => void;
  approvableCount: number;
  isApproving: boolean;
  projectId: string;
  orgId: string;
  onReload: () => void;
}

export function QuestionsHeader({
  searchQuery,
  onSearchChange,
  onApproveAll,
  onExportCsv,
  onExportDocx,
  approvableCount,
  isApproving,
  projectId,
  orgId,
  onReload,
}: QuestionsHeaderProps) {
  const { activeUsers } = usePresence(projectId, orgId);
  const { selectedQuestion, getSelectedQuestionData, setSelectedQuestion } = useQuestions() as any;

  const questionData = selectedQuestion ? getSelectedQuestionData() : null;
  const questionText = questionData?.question?.question as string | undefined;

  return (
    <div className="space-y-1">
      <PageHeader
        title={questionText ? '' : 'RFP Questions'}
        description={
          !questionText && approvableCount > 0
            ? `${approvableCount} answer${approvableCount > 1 ? 's' : ''} pending approval`
            : undefined
        }
        className={questionText ? 'mb-2' : undefined}
        actions={
          <>
            {/* Real-time presence avatars */}
            {activeUsers.length > 0 && (
              <PresenceAvatars users={activeUsers} maxVisible={5} />
            )}
            <PageSearch
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search questions..."
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onReload}
              disabled={isApproving}
              aria-label="Reload questions"
              title="Reload questions"
            >
              {isApproving ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <PermissionWrapper requiredPermission="answer:edit">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={onApproveAll}
                disabled={approvableCount === 0 || isApproving}
              >
                {isApproving ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Approving...
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-4 w-4" />
                    Approve All
                  </>
                )}
              </Button>
            </PermissionWrapper>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onExportCsv} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExportDocx} className="gap-2">
                  <FileText className="h-4 w-4" />
                  Export as DOCX
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
    </div>
  );
}