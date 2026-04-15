'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import {
  RFP_DOCUMENT_TYPES,
  useGenerateRFPDocument,
  useCustomDocumentTypes,
} from '@/lib/hooks/use-rfp-documents';
import { useGetExecutiveBriefByProject } from '@/lib/hooks/use-executive-brief';
import { useCurrentOrganization } from '@/context/organization-context';
import PermissionWrapper from '@/components/permission-wrapper';
import { TemplateSelector } from './template-selector';
import type { RequiredOutputDocument } from '@auto-rfp/core';

/** All built-in document types in win-optimized proposal order. */
const STANDARD_TYPES: { key: string; label: string }[] = [
  { key: 'COVER_LETTER',                  label: RFP_DOCUMENT_TYPES.COVER_LETTER },
  { key: 'EXECUTIVE_SUMMARY',             label: RFP_DOCUMENT_TYPES.EXECUTIVE_SUMMARY },
  { key: 'UNDERSTANDING_OF_REQUIREMENTS', label: RFP_DOCUMENT_TYPES.UNDERSTANDING_OF_REQUIREMENTS },
  { key: 'TECHNICAL_PROPOSAL',            label: RFP_DOCUMENT_TYPES.TECHNICAL_PROPOSAL },
  { key: 'PROJECT_PLAN',                  label: RFP_DOCUMENT_TYPES.PROJECT_PLAN },
  { key: 'TEAM_QUALIFICATIONS',           label: RFP_DOCUMENT_TYPES.TEAM_QUALIFICATIONS },
  { key: 'PAST_PERFORMANCE',              label: RFP_DOCUMENT_TYPES.PAST_PERFORMANCE },
  { key: 'COST_PROPOSAL',                 label: RFP_DOCUMENT_TYPES.COST_PROPOSAL },
  { key: 'MANAGEMENT_APPROACH',           label: RFP_DOCUMENT_TYPES.MANAGEMENT_APPROACH },
  { key: 'RISK_MANAGEMENT',               label: RFP_DOCUMENT_TYPES.RISK_MANAGEMENT },
  { key: 'COMPLIANCE_MATRIX',             label: RFP_DOCUMENT_TYPES.COMPLIANCE_MATRIX },
  { key: 'CERTIFICATIONS',                label: RFP_DOCUMENT_TYPES.CERTIFICATIONS },
  { key: 'APPENDICES',                    label: RFP_DOCUMENT_TYPES.APPENDICES },
  { key: 'MANAGEMENT_PROPOSAL',           label: RFP_DOCUMENT_TYPES.MANAGEMENT_PROPOSAL },
  { key: 'PRICE_VOLUME',                  label: RFP_DOCUMENT_TYPES.PRICE_VOLUME },
  { key: 'QUALITY_MANAGEMENT',            label: RFP_DOCUMENT_TYPES.QUALITY_MANAGEMENT },
  { key: 'CLARIFYING_QUESTIONS',          label: RFP_DOCUMENT_TYPES.CLARIFYING_QUESTIONS },
  { key: 'QUESTIONS_AND_ANSWERS',         label: RFP_DOCUMENT_TYPES.QUESTIONS_AND_ANSWERS },
];

interface DocRow {
  key: string;
  label: string;
  isRequired: boolean;
  isCustom: boolean;
  description?: string | null;
  pageLimit?: string | null;
}

interface DocSelection {
  checked: boolean;
  templateId: string;
}

interface GenerateDocumentDialogProps {
  projectId: string;
  opportunityId: string;
  orgId: string;
  /** Required documents from executive brief (already generated ones should be filtered out by the caller) */
  requiredDocs?: RequiredOutputDocument[];
  onSuccess?: () => void;
}

export const GenerateDocumentDialog = ({
  projectId,
  opportunityId,
  orgId,
  requiredDocs = [],
  onSuccess,
}: GenerateDocumentDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { trigger: generateDocument } = useGenerateRFPDocument(orgId);
  const { currentOrganization } = useCurrentOrganization();
  const { customTypes } = useCustomDocumentTypes(currentOrganization?.id ?? null);
  const { trigger: fetchBrief, data: briefData } = useGetExecutiveBriefByProject(orgId);
  const { toast } = useToast();

  // Fetch required docs from brief when dialog opens (if not provided via props)
  useEffect(() => {
    if (open && requiredDocs.length === 0 && projectId && opportunityId) {
      fetchBrief({ projectId, opportunityId }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Merge prop-provided required docs with brief-fetched ones
  const resolvedRequiredDocs: RequiredOutputDocument[] = useMemo(() => {
    if (requiredDocs.length > 0) return requiredDocs;
    const sections = (briefData?.brief as Record<string, unknown> | undefined)?.sections as Record<string, unknown> | undefined;
    const reqSection = sections?.requirements as Record<string, unknown> | undefined;
    const reqData = reqSection?.data as Record<string, unknown> | undefined;
    const compliance = reqData?.submissionCompliance as Record<string, unknown> | undefined;
    return (compliance?.requiredDocuments ?? []) as RequiredOutputDocument[];
  }, [requiredDocs, briefData]);

  // Build the full list of document types
  const requiredKeys = useMemo(
    () => new Set(resolvedRequiredDocs.map((d) => d.documentType)),
    [resolvedRequiredDocs],
  );

  const allRows: DocRow[] = useMemo(() => {
    const requiredDescriptions = new Map(
      resolvedRequiredDocs.map((d) => [d.documentType, { description: d.description, pageLimit: d.pageLimit }]),
    );

    const rows: DocRow[] = STANDARD_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      isRequired: requiredKeys.has(t.key),
      isCustom: false,
      description: requiredDescriptions.get(t.key)?.description,
      pageLimit: requiredDescriptions.get(t.key)?.pageLimit,
    }));

    // Add custom types
    for (const ct of customTypes) {
      if (!rows.some((r) => r.key === ct.slug)) {
        rows.push({
          key: ct.slug,
          label: ct.name,
          isRequired: requiredKeys.has(ct.slug),
          isCustom: true,
          description: ct.description,
        });
      }
    }

    // Add required docs that aren't in standard or custom (edge case)
    for (const rd of resolvedRequiredDocs) {
      if (!rows.some((r) => r.key === rd.documentType)) {
        rows.push({
          key: rd.documentType,
          label: rd.name ?? rd.documentType,
          isRequired: true,
          isCustom: false,
          description: rd.description,
          pageLimit: rd.pageLimit,
        });
      }
    }

    return rows;
  }, [resolvedRequiredDocs, requiredKeys, customTypes]);

  // Selections state
  const buildDefaults = useCallback(() => {
    const map = new Map<string, DocSelection>();
    for (const row of allRows) {
      map.set(row.key, { checked: row.isRequired, templateId: '' });
    }
    return map;
  }, [allRows]);

  const [selections, setSelections] = useState<Map<string, DocSelection>>(buildDefaults);

  // Reset when dialog opens
  const prevOpenRef = React.useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setSelections(buildDefaults());
    }
    prevOpenRef.current = open;
  }, [open, buildDefaults]);

  const checkedCount = useMemo(
    () => Array.from(selections.values()).filter((s) => s.checked).length,
    [selections],
  );

  const updateSelection = (key: string, updates: Partial<DocSelection>) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      if (current) {
        next.set(key, { ...current, ...updates });
      }
      return next;
    });
  };

  const setAllChecked = (checked: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      for (const [key, val] of next) {
        next.set(key, { ...val, checked });
      }
      return next;
    });
  };

  const selectRequired = () => {
    setSelections((prev) => {
      const next = new Map(prev);
      for (const [key, val] of next) {
        next.set(key, { ...val, checked: requiredKeys.has(key) });
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    const toGenerate = allRows.filter((r) => selections.get(r.key)?.checked);
    if (toGenerate.length === 0) return;

    setIsGenerating(true);
    try {
      await Promise.all(
        toGenerate.map((row) => {
          const sel = selections.get(row.key);
          return generateDocument({
            projectId,
            opportunityId,
            documentType: row.key,
            ...(sel?.templateId ? { templateId: sel.templateId } : {}),
          });
        }),
      );
      toast({
        title: 'Generation started',
        description: `${toGenerate.length} document${toGenerate.length === 1 ? '' : 's'} queued for generation.`,
      });
      onSuccess?.();
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : 'Failed to start generation',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const hasRequired = requiredKeys.size > 0;
  const allChecked = checkedCount === allRows.length;

  return (
    <PermissionWrapper requiredPermission="proposal:create">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Brain className="h-4 w-4 mr-2" />
            Generate
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate Documents</DialogTitle>
            <DialogDescription>
              Select document types to generate and choose a template for each.
            </DialogDescription>
          </DialogHeader>

          {/* Quick filters */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={allChecked ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setAllChecked(!allChecked)}
            >
              {allChecked ? 'Deselect all' : 'Select all'}
            </Button>
            {hasRequired && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={selectRequired}
              >
                Select required ({requiredKeys.size})
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {checkedCount} selected
            </span>
          </div>

          <Separator />

          {/* Document rows */}
          <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
            {allRows.map((row) => {
              const sel = selections.get(row.key);
              const isChecked = sel?.checked ?? false;

              return (
                <div
                  key={row.key}
                  className="rounded-lg border px-3 py-2 flex items-center gap-3"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      updateSelection(row.key, { checked: !!checked })
                    }
                    id={`gen-${row.key}`}
                  />
                  <Label
                    htmlFor={`gen-${row.key}`}
                    className="text-sm font-medium cursor-pointer flex-1 min-w-0 truncate"
                  >
                    {row.label}
                  </Label>
                  {row.isRequired && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      Required
                    </Badge>
                  )}
                  {row.isCustom && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      Custom
                    </Badge>
                  )}
                  {row.pageLimit && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {row.pageLimit}
                    </span>
                  )}
                  <div className="w-44 shrink-0">
                    <TemplateSelector
                      orgId={orgId}
                      documentType={row.key}
                      value={sel?.templateId ?? ''}
                      onChange={(templateId) =>
                        updateSelection(row.key, { templateId })
                      }
                      disabled={!isChecked}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isGenerating}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={isGenerating || checkedCount === 0}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Brain className="h-4 w-4 mr-2" />
                  Generate ({checkedCount})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionWrapper>
  );
};
