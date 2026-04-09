'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { useOpportunity } from '@/lib/hooks/use-opportunities';
import { useRFPDocuments, RFP_DOCUMENT_TYPES, type RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';
import { useComplianceReport } from '@/features/proposal-submission/hooks/useComplianceReport';
import { useIgnoredChecks } from '@/features/proposal-submission/hooks/useIgnoredChecks';
import { useSubmitProposal } from '@/features/proposal-submission/hooks/useSubmitProposal';
import { useCurrentOrganization } from '@/context/organization-context';
import type { SubmitProposal } from '@auto-rfp/core';

// ─── Submission Methods ──────────────────────────────────────────────────────

const SUBMISSION_METHODS = [
  { value: 'PORTAL', label: 'Agency Portal (SAM.gov, etc.)' },
  { value: 'EMAIL', label: 'Email to Contracting Officer' },
  { value: 'MANUAL', label: 'Manual / Other System' },
  { value: 'HAND_DELIVERY', label: 'Hand Delivery' },
  { value: 'OTHER', label: 'Other' },
] as const;

// ─── Page Component ──────────────────────────────────────────────────────────

export default function SubmitProposalPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganization } = useCurrentOrganization();

  const orgId = (params.orgId as string) || currentOrganization?.id || '';
  const projectId = params.projectId as string;
  const oppId = params.oppId as string;

  // Data hooks
  const { data: opportunity, isLoading: isLoadingOpp, refetch: refetchOpp } = useOpportunity(projectId, oppId, orgId);
  const { documents, isLoading: isLoadingDocs } = useRFPDocuments(projectId, orgId, oppId);
  const { categories, totalChecks, isLoading: isLoadingCompliance } = useComplianceReport(orgId, projectId, oppId);
  const { ignoredIds } = useIgnoredChecks({
    orgId,
    projectId,
    oppId,
    opportunity: opportunity as Record<string, unknown> | null,
    refetch: refetchOpp,
  });
  const { submit, isLoading: isSubmitting } = useSubmitProposal();

  // Form state
  const [submissionMethod, setSubmissionMethod] = useState<string>('PORTAL');
  const [submissionReference, setSubmissionReference] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Document selection
  const exportableDocs = useMemo(
    () => documents.filter((d) => !d.deletedAt && d.status !== 'GENERATING'),
    [documents],
  );
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() =>
    new Set(exportableDocs.map((d) => d.documentId)),
  );

  // Sync selection when docs load
  useMemo(() => {
    if (exportableDocs.length > 0 && selectedDocIds.size === 0) {
      setSelectedDocIds(new Set(exportableDocs.map((d) => d.documentId)));
    }
  }, [exportableDocs]);

  const toggleDoc = (docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedDocIds.size === exportableDocs.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(exportableDocs.map((d) => d.documentId)));
    }
  };

  // Compliance stats (excluding ignored)
  const effectiveBlockingFails = useMemo(
    () => categories.reduce(
      (sum, cat) => sum + cat.checks.filter((c) => !c.passed && c.blocking && !ignoredIds.has(c.id)).length,
      0,
    ),
    [categories, ignoredIds],
  );
  const effectivePassRate = useMemo(() => {
    const total = categories.reduce((sum, cat) => sum + cat.totalChecks, 0);
    const effectivePassed = categories.reduce(
      (sum, cat) => sum + cat.checks.filter((c) => c.passed || ignoredIds.has(c.id)).length,
      0,
    );
    return total > 0 ? Math.round((effectivePassed / total) * 100) : 100;
  }, [categories, ignoredIds]);
  const isReady = effectiveBlockingFails === 0;

  // Opportunity info
  const oppTitle = (opportunity as Record<string, unknown>)?.title as string ?? 'Proposal';
  const solNumber = (opportunity as Record<string, unknown>)?.solicitationNumber as string ?? '';
  const orgName = (opportunity as Record<string, unknown>)?.organizationName as string ?? '';

  // Email draft (live preview)
  const emailSubject = `Proposal Submission${solNumber ? ` — ${solNumber}` : ''}: ${oppTitle}`;
  const selectedDocs = exportableDocs.filter((d) => selectedDocIds.has(d.documentId));
  const emailBody = useMemo(() => [
    `Dear ${orgName ? orgName + ' ' : ''}Contracting Officer,`,
    '',
    `Please find attached our proposal in response to${solNumber ? ` Solicitation ${solNumber}` : ' the referenced solicitation'}${oppTitle !== 'Proposal' ? ` — "${oppTitle}"` : ''}.`,
    '',
    `This submission includes ${selectedDocs.length} document(s):`,
    ...selectedDocs.map((d, i) => `  ${i + 1}. ${d.name}`),
    '',
    'Please confirm receipt at your earliest convenience.',
    '',
    'Best regards',
  ].join('\n'), [oppTitle, solNumber, orgName, selectedDocs]);

  // Submit handler
  const handleSubmit = async () => {
    if (!isReady && effectiveBlockingFails > 0) return;

    const dto: SubmitProposal = {
      orgId,
      projectId,
      oppId,
      submissionMethod: submissionMethod as SubmitProposal['submissionMethod'],
      submissionReference: submissionReference || undefined,
      portalUrl: portalUrl || undefined,
      submissionNotes: notes || undefined,
      documentIds: [...selectedDocIds],
      forceSubmit: false,
    };

    const result = await submit(dto);
    if (result) {
      toast({ title: 'Proposal Submitted', description: 'Submission recorded successfully.' });
      router.push(`/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`);
    } else {
      toast({ title: 'Submission Failed', description: 'Could not submit. Check compliance.', variant: 'destructive' });
    }
  };

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`;

  if (isLoadingOpp) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Submit Proposal</h1>
        <p className="text-muted-foreground mt-1">
          {oppTitle}
          {solNumber && <Badge variant="outline" className="ml-2 text-xs">{solNumber}</Badge>}
        </p>
      </div>

      {/* 1. Compliance Summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Compliance
            </CardTitle>
            <Badge variant={isReady ? 'default' : 'destructive'}>
              {isReady ? 'Ready' : `${effectiveBlockingFails} blocking`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingCompliance ? (
            <Skeleton className="h-4 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{effectivePassRate}% passed · {totalChecks} checks</span>
              </div>
              <Progress value={effectivePassRate} className="h-2" />
              {!isReady && (
                <p className="text-xs text-destructive">
                  Resolve or ignore all blocking checks before submitting.
                  <Link href={backUrl} className="underline ml-1">View details</Link>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Documents to Include */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {selectedDocIds.size} of {exportableDocs.length} selected
            </span>
          </div>
          <CardDescription>Select which documents to include in the submission record.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingDocs ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : exportableDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No documents available.</p>
          ) : (
            <div className="space-y-1">
              <label className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 cursor-pointer border-b">
                <Checkbox
                  checked={selectedDocIds.size === exportableDocs.length}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm font-medium">Select all</span>
              </label>
              {exportableDocs.map((doc) => {
                const typeLabel = RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType;
                return (
                  <label
                    key={doc.documentId}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedDocIds.has(doc.documentId)}
                      onCheckedChange={() => toggleDoc(doc.documentId)}
                    />
                    <span className="text-sm flex-1 truncate">{doc.name}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{typeLabel}</Badge>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Delivery Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" />
            Delivery Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Submission Method</Label>
            <Select value={submissionMethod} onValueChange={setSubmissionMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBMISSION_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Confirmation / Tracking Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={submissionReference}
                onChange={(e) => setSubmissionReference(e.target.value)}
                placeholder="e.g. SAM-2025-001234"
              />
            </div>
            <div className="space-y-2">
              <Label>Portal URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={portalUrl}
                onChange={(e) => setPortalUrl(e.target.value)}
                placeholder="https://sam.gov/opp/..."
                type="url"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this submission..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. Email Draft */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Draft
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
                  toast({ title: 'Copied to clipboard' });
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open in Email
              </Button>
            </div>
          </div>
          <CardDescription>Pre-filled email template. Copy or open in your email client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Input value={emailSubject} readOnly className="text-sm bg-muted/30" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Body</Label>
            <Textarea value={emailBody} readOnly rows={8} className="text-sm font-mono bg-muted/30" />
          </div>
          {selectedDocs.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Attachments ({selectedDocs.length})</Label>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {selectedDocs.map((d) => (
                  <div key={d.documentId} className="flex items-center gap-1.5">
                    <Download className="h-3 w-3" />
                    {d.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Submit */}
      <Separator />
      <div className="flex items-center justify-between pb-8">
        <Button variant="outline" asChild>
          <Link href={backUrl}>Cancel</Link>
        </Button>
        <Button
          size="lg"
          disabled={!isReady || isSubmitting || selectedDocIds.size === 0}
          onClick={handleSubmit}
          className="gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Submit Proposal
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
