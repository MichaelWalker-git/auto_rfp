'use client';

import React, { useState } from 'react';
import { Brain, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { type RFPDocumentType, RFP_DOCUMENT_TYPES, RFP_DOCUMENT_TYPE_DESCRIPTIONS, useGenerateRFPDocument, useCustomDocumentTypes } from '@/lib/hooks/use-rfp-documents';
import { useCurrentOrganization } from '@/context/organization-context';
import PermissionWrapper from '@/components/permission-wrapper';

/**
 * All AI-generatable document types in win-optimized proposal order.
 */
const GENERATABLE_TYPES_CONFIG: { key: string; label: string }[] = [
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
];

interface GenerateDocumentDialogProps {
  projectId: string;
  opportunityId: string;
  orgId: string;
  onSuccess?: () => void;
}

export function GenerateDocumentDialog({
  projectId,
  opportunityId,
  orgId,
  onSuccess,
}: GenerateDocumentDialogProps) {
  const [selectedType, setSelectedType] = useState<string>('TECHNICAL_PROPOSAL');
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { trigger: triggerGenerate } = useGenerateRFPDocument(orgId);
  const { currentOrganization } = useCurrentOrganization();
  const { customTypes } = useCustomDocumentTypes(currentOrganization?.id ?? null);

  // Merge built-in types with custom types (custom types appear at the bottom under "Custom")
  const allTypes: { key: string; label: string; isCustom?: boolean }[] = [
    ...GENERATABLE_TYPES_CONFIG,
    ...customTypes.map(ct => ({ key: ct.slug, label: ct.name, isCustom: true })),
  ];

  const handleGenerate = async () => {
    setStatus('generating');
    setErrorMessage(null);
    setIsOpen(false);

    try {
      // No templateId passed — backend auto-selects the most recent active template
      // for the selected document type
      await triggerGenerate({
        projectId,
        opportunityId,
        documentType: selectedType,
      });
      setStatus('success');
      onSuccess?.();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Generation failed');
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const isGenerating = status === 'generating';
  const selectedLabel = GENERATABLE_TYPES_CONFIG.find(t => t.key === selectedType)?.label ?? 'document';

  if (isGenerating) {
    return (
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Generating {selectedLabel}...
      </Button>
    );
  }

  if (status === 'success') {
    return (
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-600 border-green-200" disabled>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Document created
      </Button>
    );
  }

  if (status === 'error') {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5 text-red-500 border-red-200"
        title={errorMessage ?? 'Generation failed'}
        onClick={() => setStatus('idle')}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Failed — click to retry
      </Button>
    );
  }

  return (
    <PermissionWrapper requiredPermission="proposal:create">
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
            <Brain className="h-3.5 w-3.5" />
            Generate
            <ChevronDown className="h-3 w-3 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 p-3" align="end">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Document Type</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-xs text-muted-foreground">Standard</SelectLabel>
                    {GENERATABLE_TYPES_CONFIG.map(({ key, label }) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customTypes.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel className="text-xs text-muted-foreground">AI-Discovered</SelectLabel>
                        {customTypes.map(ct => (
                          <SelectItem key={ct.slug} value={ct.slug} className="text-xs">
                            {ct.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
              {selectedType && RFP_DOCUMENT_TYPE_DESCRIPTIONS[selectedType as keyof typeof RFP_DOCUMENT_TYPE_DESCRIPTIONS] && (
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {RFP_DOCUMENT_TYPE_DESCRIPTIONS[selectedType as keyof typeof RFP_DOCUMENT_TYPE_DESCRIPTIONS]}
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="w-full h-9 text-xs"
              onClick={handleGenerate}
            >
              <Brain className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Generate {selectedLabel}</span>
            </Button>
            <p className="text-[10px] text-muted-foreground leading-tight">
              AI will generate the document using your solicitation files, Q&A, knowledge base, and the most recent template for this document type.
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </PermissionWrapper>
  );
}
