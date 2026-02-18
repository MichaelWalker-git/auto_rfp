'use client';

import React, { useState } from 'react';
import { Brain, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useGenerateProposal } from '@/lib/hooks/use-proposal';
import { type RFPDocumentType } from '@/lib/hooks/use-rfp-documents';
import PermissionWrapper from '@/components/permission-wrapper';

const GENERATABLE_TYPES_CONFIG: { key: string; label: string }[] = [
  { key: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { key: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { key: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { key: 'PRICE_VOLUME', label: 'Price Volume' },
  { key: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { key: 'CERTIFICATIONS', label: 'Certifications' },
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
  const [selectedType, setSelectedType] = useState<RFPDocumentType>('TECHNICAL_PROPOSAL');
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { trigger: triggerGenerate } = useGenerateProposal();

  const handleGenerate = async () => {
    setStatus('generating');
    setErrorMessage(null);
    setIsOpen(false);

    try {
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
              <Select
                value={selectedType}
                onValueChange={(v) => setSelectedType(v as RFPDocumentType)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENERATABLE_TYPES_CONFIG.map(({ key, label }) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full h-9 text-xs"
              onClick={handleGenerate}
            >
              <Brain className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Generate</span>
            </Button>
            <p className="text-[10px] text-muted-foreground leading-tight">
              AI will generate the document using your solicitation files, Q&A, and knowledge base. It will appear in the list automatically.
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </PermissionWrapper>
  );
}
