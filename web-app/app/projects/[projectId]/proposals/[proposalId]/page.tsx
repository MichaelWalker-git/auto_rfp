'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWRMutation from 'swr/mutation';
import { ArrowLeft, CheckCircle2, Loader2, Save, Trash2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useApi } from '@/lib/hooks/use-api';

import {
  type Proposal,
  type ProposalDocument,
  ProposalSchema,
  type ProposalSection,
  ProposalStatus,
  type ProposalSubsection,
  type SaveProposalRequest,
  SaveProposalRequestSchema,
} from '@auto-rfp/shared';

const BASE = `${env.BASE_API_URL}/proposal`;

type PendingDelete =
  | { type: 'section'; sectionIndex: number }
  | { type: 'subsection'; sectionIndex: number; subsectionIndex: number }
  | null;

// --------------------
// Data hooks (page-local)
// --------------------
function useProposalById(projectId?: string | null, proposalId?: string | null) {
  const qs = new URLSearchParams();
  if (projectId) qs.set('projectId', projectId);
  if (proposalId) qs.set('proposalId', proposalId);

  const url = projectId && proposalId ? `${BASE}/get-proposal?${qs.toString()}` : null;
  const key = projectId && proposalId ? ['proposal', projectId, proposalId] : null;

  const { data, error, isLoading, mutate } = useApi<Proposal>(key as any, url);

  const parsed = data ? ProposalSchema.safeParse(data) : null;

  return {
    proposal: parsed?.success ? parsed.data : null,
    error: error ?? (parsed && !parsed.success ? parsed.error : null),
    isLoading,
    refresh: mutate,
  };
}

function useSaveProposal() {
  return useSWRMutation<Proposal, any, string, SaveProposalRequest>(
    `${BASE}/save-proposal`,
    async (url, { arg }) => {
      const parsedArgs = SaveProposalRequestSchema.safeParse(arg);
      if (!parsedArgs.success) {
        throw new Error(
          parsedArgs.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
        );
      }

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(parsedArgs.data),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const err = new Error(message || 'Failed to save proposal') as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const json = await res.json();
      const parsed = ProposalSchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`API returned invalid Proposal: ${issues}`);
      }

      return parsed.data;
    },
  );
}

// --------------------
// Helpers
// --------------------

function ensureNonEmptySections(sections: ProposalDocument['sections']): ProposalDocument['sections'] {
  if (sections.length > 0) return sections;

  const fallback: ProposalSection = {
    id: crypto.randomUUID(),
    title: 'New section',
    summary: null,
    subsections: [],
  };

  // cast to satisfy non-empty tuple type
  return [fallback] as unknown as ProposalDocument['sections'];
}

function cloneProposal(p: Proposal): Proposal {
  // structuredClone is great in modern browsers; fallback is JSON.
  try {
    return structuredClone(p);
  } catch {
    return JSON.parse(JSON.stringify(p)) as Proposal;
  }
}

// --------------------
// Page
// --------------------

export default function ProposalDetailsPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string; proposalId: string }>();

  const projectId = params?.projectId ?? '';
  const proposalId = params?.proposalId ?? '';

  const { proposal, isLoading, error, refresh } = useProposalById(projectId, proposalId);
  const { trigger: saveTrigger, isMutating: isSaving, error: saveError } = useSaveProposal();

  const [draft, setDraft] = useState<Proposal | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  // initialize draft once proposal arrives (but don’t overwrite user edits)
  React.useEffect(() => {
    if (proposal && !draft) setDraft(cloneProposal(proposal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const deleteTitle = useMemo(() => {
    if (!pendingDelete) return 'Remove item?';
    return pendingDelete.type === 'section' ? 'Remove section?' : 'Remove subsection?';
  }, [pendingDelete]);

  const deleteDescription = useMemo(() => {
    if (!pendingDelete || !draft) return 'This action cannot be undone.';

    if (pendingDelete.type === 'section') {
      const s = draft.document.sections[pendingDelete.sectionIndex];
      return `This will remove the section "${s?.title ?? ''}" and all its subsections.`;
    }

    const s = draft.document.sections[pendingDelete.sectionIndex];
    const sub = s?.subsections?.[pendingDelete.subsectionIndex];
    return `This will remove the subsection "${sub?.title ?? ''}".`;
  }, [pendingDelete, draft]);

  const openDeleteConfirm = (payload: Exclude<PendingDelete, null>) => {
    setPendingDelete(payload);
    setConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setConfirmOpen(false);
    setPendingDelete(null);
  };

  const confirmDelete = () => {
    if (!draft || !pendingDelete) return;

    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProposal(prev);

      if (pendingDelete.type === 'section') {
        const filtered = next.document.sections.filter((_, i) => i !== pendingDelete.sectionIndex);
        next.document.sections = ensureNonEmptySections(filtered as any);
      } else {
        const { sectionIndex, subsectionIndex } = pendingDelete;
        const section = next.document.sections[sectionIndex];
        if (section) {
          section.subsections = section.subsections.filter((_, i) => i !== subsectionIndex);
        }
      }

      return next;
    });

    closeDeleteConfirm();
  };

  const setDocField = <K extends keyof ProposalDocument>(key: K, value: ProposalDocument[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProposal(prev);
      next.document[key] = value;
      // auto title sync (optional)
      if (key === 'proposalTitle' && !next.title) next.title = (value as any) ?? null;
      return next;
    });
  };

  const setSectionField = (sectionIndex: number, key: keyof ProposalSection, value: any) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProposal(prev);
      const s = next.document.sections[sectionIndex];
      if (!s) return next;
      (s as any)[key] = value;
      return next;
    });
  };

  const setSubsectionField = (
    sectionIndex: number,
    subsectionIndex: number,
    key: keyof ProposalSubsection,
    value: any,
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProposal(prev);
      const s = next.document.sections[sectionIndex];
      const sub = s?.subsections?.[subsectionIndex];
      if (!sub) return next;
      (sub as any)[key] = value;
      return next;
    });
  };

  const doSave = async (nextStatus?: ProposalStatus) => {
    if (!draft) return;

    setLocalMessage(null);

    const payload = SaveProposalRequestSchema.parse({
      id: draft.id,
      projectId: draft.projectId,
      organizationId: draft.organizationId ?? null,
      status: nextStatus ?? draft.status ?? ProposalStatus.NEW,
      title: draft.title ?? draft.document.proposalTitle ?? null,
      document: draft.document,
    });

    const saved = await saveTrigger(payload);

    // update UI with canonical server state
    setDraft(cloneProposal(saved));
    setLocalMessage('Saved');

    // refresh SWR cache (best practice)
    await refresh();
    setTimeout(() => setLocalMessage(null), 1500);
  };

  const isBusy = isLoading || isSaving;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div>
            <h1 className="text-xl font-semibold leading-tight">
              Proposal
              <span className="text-muted-foreground font-normal"> • {proposalId}</span>
            </h1>
            {draft?.status && (
              <p className="text-xs text-muted-foreground mt-1">Status: {draft.status}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!draft || isBusy}
            onClick={() => doSave()}
            className="gap-2"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>

          <Button
            variant="outline"
            disabled={!draft || isBusy}
            onClick={() => doSave(ProposalStatus.APPROVED)}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve
          </Button>

          <Button
            variant="destructive"
            disabled={!draft || isBusy}
            onClick={() => doSave(ProposalStatus.REJECTED)}
            className="gap-2"
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
        </div>
      </div>

      {(error || saveError) && (
        <div className="text-sm text-red-500 border border-red-500/30 rounded-md px-3 py-2 bg-red-500/5">
          {String((error as any)?.message ?? (saveError as any)?.message ?? 'Something went wrong')}
        </div>
      )}

      {localMessage && (
        <div className="text-sm text-green-600 border border-green-600/30 rounded-md px-3 py-2 bg-green-500/5">
          {localMessage}
        </div>
      )}

      {isLoading && !draft && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading proposal...
        </div>
      )}

      {draft && (
        <ScrollArea className="h-[calc(100vh-190px)] border rounded-md">
          <div className="p-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Proposal title</Label>
                    <Input
                      value={draft.document.proposalTitle}
                      onChange={(e) => setDocField('proposalTitle', e.target.value)}
                      disabled={isBusy}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Customer name</Label>
                    <Input
                      value={draft.document.customerName ?? ''}
                      onChange={(e) =>
                        setDocField('customerName', e.target.value ? e.target.value : undefined)
                      }
                      disabled={isBusy}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Opportunity ID</Label>
                    <Input
                      value={draft.document.opportunityId ?? ''}
                      onChange={(e) =>
                        setDocField('opportunityId', e.target.value ? e.target.value : undefined)
                      }
                      disabled={isBusy}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <Label>Outline summary</Label>
                    <Textarea
                      rows={3}
                      value={draft.document.outlineSummary ?? ''}
                      onChange={(e) =>
                        setDocField('outlineSummary', e.target.value ? e.target.value : undefined)
                      }
                      disabled={isBusy}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {draft.document.sections.map((section, sectionIndex) => (
                <div
                  key={`${section.id || 'section'}-${sectionIndex}`}
                  className="border rounded-md p-3 space-y-3 bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Section {sectionIndex + 1}</Label>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500"
                      onClick={() => openDeleteConfirm({ type: 'section', sectionIndex })}
                      disabled={isBusy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={section.title}
                      onChange={(e) => setSectionField(sectionIndex, 'title', e.target.value)}
                      disabled={isBusy}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Summary</Label>
                    <Textarea
                      rows={3}
                      value={section.summary ?? ''}
                      onChange={(e) => setSectionField(sectionIndex, 'summary', e.target.value)}
                      disabled={isBusy}
                    />
                  </div>

                  <div className="space-y-3">
                    {section.subsections.map((subsection, subsectionIndex) => (
                      <div
                        key={`${subsection.id || 'sub'}-${sectionIndex}-${subsectionIndex}`}
                        className="border rounded-md p-3 space-y-2 bg-background"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs font-semibold">
                            Subsection {sectionIndex + 1}.{subsectionIndex + 1}
                          </Label>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500"
                            onClick={() =>
                              openDeleteConfirm({
                                type: 'subsection',
                                sectionIndex,
                                subsectionIndex,
                              })
                            }
                            disabled={isBusy}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="space-y-1">
                          <Label>Title</Label>
                          <Input
                            value={subsection.title}
                            onChange={(e) =>
                              setSubsectionField(sectionIndex, subsectionIndex, 'title', e.target.value)
                            }
                            disabled={isBusy}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Content</Label>
                          <Textarea
                            rows={6}
                            value={subsection.content}
                            onChange={(e) =>
                              setSubsectionField(
                                sectionIndex,
                                subsectionIndex,
                                'content',
                                e.target.value,
                              )
                            }
                            disabled={isBusy}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      {/* Delete confirm modal */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
