'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileDown, Loader2 } from 'lucide-react';
import type { ClarifyingQuestionsExportOptions } from '@auto-rfp/core';

interface ExportQuestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  opportunityId: string;
  orgId: string;
  questionCount: number;
  onExport: (
    orgId: string,
    projectId: string,
    opportunityId: string,
    options?: Partial<ClarifyingQuestionsExportOptions>,
  ) => Promise<{ documentId: string } | null>;
  isExporting: boolean;
}

export const ExportQuestionsDialog = ({
  open,
  onOpenChange,
  projectId,
  opportunityId,
  orgId,
  questionCount,
  onExport,
  isExporting,
}: ExportQuestionsDialogProps) => {
  const router = useRouter();

  const [excludeDismissed, setExcludeDismissed] = useState(true);
  const [includeRationale, setIncludeRationale] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [sortBy, setSortBy] = useState<'priority' | 'category' | 'createdAt'>('priority');

  const handleExport = async () => {
    const options: Partial<ClarifyingQuestionsExportOptions> = {
      excludeStatuses: excludeDismissed ? ['DISMISSED'] : [],
      includeRationale,
      includeReferences,
      groupByCategory,
      sortBy,
      sortOrder: 'desc',
    };

    const result = await onExport(orgId, projectId, opportunityId, options);

    if (result?.documentId) {
      onOpenChange(false);
      // Navigate to the document editor
      router.push(`/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/rfp-documents/${result.documentId}/edit`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Clarifying Questions</DialogTitle>
          <DialogDescription>
            Create a formatted document from {questionCount} questions. You can edit the document
            before exporting to PDF or DOCX.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Filter Options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Include Questions</Label>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="exclude-dismissed"
                checked={excludeDismissed}
                onCheckedChange={(checked) => setExcludeDismissed(checked as boolean)}
              />
              <label htmlFor="exclude-dismissed" className="text-sm">
                Exclude dismissed questions
              </label>
            </div>
          </div>

          {/* Sort Options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Sort By</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Priority (High → Low)</SelectItem>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="createdAt">Date Created</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Content Options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Content Options</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="group-category"
                  checked={groupByCategory}
                  onCheckedChange={(checked) => setGroupByCategory(checked as boolean)}
                />
                <label htmlFor="group-category" className="text-sm">
                  Group by category
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-rationale"
                  checked={includeRationale}
                  onCheckedChange={(checked) => setIncludeRationale(checked as boolean)}
                />
                <label htmlFor="include-rationale" className="text-sm">
                  Include rationale (why ask this question)
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-references"
                  checked={includeReferences}
                  onCheckedChange={(checked) => setIncludeReferences(checked as boolean)}
                />
                <label htmlFor="include-references" className="text-sm">
                  Include RFP references
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                Create Document
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
