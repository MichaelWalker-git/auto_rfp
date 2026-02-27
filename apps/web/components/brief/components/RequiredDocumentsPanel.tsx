'use client';

import React, { useState } from 'react';
import { Brain, CheckCircle2, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useGenerateRFPDocument, useRFPDocuments, RFP_DOCUMENT_TYPES } from '@/lib/hooks/use-rfp-documents';
import { useCurrentOrganization } from '@/context/organization-context';
import type { RequiredOutputDocument } from '@auto-rfp/core';
import Link from 'next/link';

interface RequiredDocumentsPanelProps {
  projectId: string;
  opportunityId: string;
  requiredDocuments: RequiredOutputDocument[];
  /** Called after any document is successfully generated */
  onGenerated?: () => void;
}

export const RequiredDocumentsPanel = ({
  projectId,
  opportunityId,
  requiredDocuments,
  onGenerated,
}: RequiredDocumentsPanelProps) => {
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id ?? '';
  const { trigger: generateDocument } = useGenerateRFPDocument(orgId);
  const { documents, isLoading: isLoadingDocs, mutate: refreshDocs } = useRFPDocuments(projectId, orgId, opportunityId);
  const { toast } = useToast();

  const [generatingTypes, setGeneratingTypes] = useState<Set<string>>(new Set());
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  if (!requiredDocuments.length) return null;

  // Build a map of documentType → existing RFP documents for this opportunity
  const existingByType = new Map<string, { documentId: string; name: string; status?: string | null }>();
  for (const doc of documents) {
    if (!existingByType.has(doc.documentType)) {
      existingByType.set(doc.documentType, {
        documentId: doc.documentId,
        name: doc.name,
        status: doc.status,
      });
    }
  }

  const handleGenerate = async (doc: RequiredOutputDocument) => {
    if (generatingTypes.has(doc.documentType)) return;

    setGeneratingTypes((prev) => new Set(prev).add(doc.documentType));
    try {
      await generateDocument({ projectId, opportunityId, documentType: doc.documentType });
      await refreshDocs();
      toast({ title: `"${doc.name}" generated`, description: 'Document is ready in RFP Documents.' });
      onGenerated?.();
    } catch (err: any) {
      toast({
        title: `Failed to generate "${doc.name}"`,
        description: err?.message || 'Generation failed',
        variant: 'destructive',
      });
    } finally {
      setGeneratingTypes((prev) => {
        const next = new Set(prev);
        next.delete(doc.documentType);
        return next;
      });
    }
  };

  const handleGenerateAll = async () => {
    setIsGeneratingAll(true);
    const pending = requiredDocuments.filter((d) => !existingByType.has(d.documentType));
    for (const doc of pending) {
      await handleGenerate(doc);
    }
    setIsGeneratingAll(false);
  };

  const allGenerated = requiredDocuments.every((d) => existingByType.has(d.documentType));
  const pendingCount = requiredDocuments.filter((d) => !existingByType.has(d.documentType)).length;

  return (
    <Card className="border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-600" />
            <CardTitle className="text-base">Required Response Documents</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {requiredDocuments.length} document{requiredDocuments.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          {!allGenerated && (
            <Button
              size="sm"
              onClick={handleGenerateAll}
              disabled={isGeneratingAll || generatingTypes.size > 0 || isLoadingDocs}
              className="gap-1.5"
            >
              {isGeneratingAll ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating {pendingCount}…
                </>
              ) : (
                <>
                  <Brain className="h-3.5 w-3.5" />
                  Generate All ({pendingCount})
                </>
              )}
            </Button>
          )}
          {allGenerated && (
            <Badge className="bg-green-600/90 gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All generated
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          These documents were identified as required by the solicitation. Generate them to start your proposal response.
        </p>
      </CardHeader>

      <CardContent className="space-y-2">
        {requiredDocuments.map((doc) => {
          const isGenerating = generatingTypes.has(doc.documentType);
          const existing = existingByType.get(doc.documentType);
          const isGenerated = !!existing;
          const isGeneratingStatus = existing?.status === 'GENERATING';
          const label = RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType;

          return (
            <div
              key={doc.documentType}
              className="flex items-center gap-3 rounded-lg border bg-background p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{doc.name}</span>
                  <Badge variant="outline" className="text-xs h-5 px-1.5 text-muted-foreground">
                    {label}
                  </Badge>
                  {doc.required && (
                    <Badge variant="destructive" className="text-xs h-5 px-1.5">
                      Required
                    </Badge>
                  )}
                  {doc.pageLimit && (
                    <span className="text-xs text-muted-foreground">· {doc.pageLimit}</span>
                  )}
                </div>
                {doc.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{doc.description}</p>
                )}
                {isGenerated && existing && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    <FileText className="inline h-3 w-3 mr-0.5" />
                    {existing.name}
                    {existing.status && existing.status !== 'COMPLETE' && (
                      <span className="ml-1 text-amber-600">· {existing.status}</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isGeneratingStatus ? (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating
                  </Badge>
                ) : isGenerated && existing && orgId ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" asChild>
                    <Link href={`/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/rfp-documents/${existing.documentId}/edit`}>
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleGenerate(doc)}
                    disabled={isGenerating || isGeneratingAll || isLoadingDocs}
                    className="shrink-0 h-7 text-xs gap-1"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Brain className="h-3 w-3" />
                        Generate
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
