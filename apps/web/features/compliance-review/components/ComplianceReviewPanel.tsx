'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, Loader2, MessageSquare, Play, Send, Sparkles, User } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useReviewRun } from '../hooks/useReviewRun';
import { useUnifiedChat } from '../hooks/useUnifiedChat';
import { useFindingDecisions } from '../hooks/useFindingDecisions';
import { FindingsList } from './FindingsList';
import { FindingsStats } from './FindingsStats';
import { ALL, FindingsFilterBar, applyFilter, emptyFilter, isFilterActive, type FindingsFilter } from './FindingsFilterBar';
import type { ComplianceFindingSeverity } from '@auto-rfp/core';
import { ProposalRunView } from '@/features/package-edit';

interface ComplianceReviewPanelProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

// Starter prompts for the empty chat — remove the blank-slate friction and teach
// what the surface can do. Editors get a review + an edit example; viewers get
// review-only prompts (they can't start edits).
const CHAT_SUGGESTIONS_REVIEW = [
  'Which required forms am I missing?',
  'Is the company name consistent across all documents?',
  'Does the technical volume address Section L?',
];
const CHAT_SUGGESTIONS_EDIT = ['Change the contact email everywhere to new@acme.com.'];

export const ComplianceReviewPanel = ({ orgId, projectId, oppId }: ComplianceReviewPanelProps) => {
  const { findings, decisions, stale, isRunning, isLoading, triggerReview, refresh, status } =
    useReviewRun(orgId, projectId, oppId);
  const { messages, isLoadingHistory, sendMessage, isSending, canEdit } = useUnifiedChat(
    orgId,
    projectId,
    oppId,
  );
  const { activeFindings, dismissedFindings, resolvedFindings, setDecision } = useFindingDecisions(
    orgId,
    projectId,
    oppId,
    findings,
    decisions,
    refresh,
  );

  const [input, setInput] = useState('');
  // Global expand/minimize for all finding cards. `expandSignal` bumps on each
  // toggle so cards re-sync even if individually toggled since the last press.
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [expandSignal, setExpandSignal] = useState(0);
  const toggleAllDetails = () => {
    setDetailsExpanded((v) => !v);
    setExpandSignal((n) => n + 1);
  };

  // Collapse the findings area down to a stats summary (cards hidden). Everything
  // above the cards (run button, banners, filter) stays visible when collapsed.
  const [findingsCollapsed, setFindingsCollapsed] = useState(false);

  const hasFindings =
    activeFindings.length + dismissedFindings.length + resolvedFindings.length > 0;

  // ProposalRunView polls the LATEST run for the opportunity, so only the most
  // recent edit turn should render it live; older edit turns in history are shown
  // as a plain note (their run is superseded).
  const latestEditRunId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].editRunId) return messages[i].editRunId;
    }
    return undefined;
  }, [messages]);

  // Client-side filter by severity + issue type + document (Full Review tab only).
  const [filter, setFilter] = useState<FindingsFilter>(emptyFilter);
  // Clicking a severity badge in the summary toggles the severity filter (click
  // the active one to clear it). Expands the findings if they were collapsed so
  // the filtered result is visible.
  const toggleSeverity = (severity: ComplianceFindingSeverity) => {
    setFilter((f) => ({ ...f, severity: f.severity === severity ? ALL : severity }));
    setFindingsCollapsed(false);
  };
  const allFindings = useMemo(
    () => [...activeFindings, ...resolvedFindings, ...dismissedFindings],
    [activeFindings, resolvedFindings, dismissedFindings],
  );
  const filteredActive = useMemo(() => applyFilter(activeFindings, filter), [activeFindings, filter]);
  const filteredResolved = useMemo(() => applyFilter(resolvedFindings, filter), [resolvedFindings, filter]);
  const filteredDismissed = useMemo(() => applyFilter(dismissedFindings, filter), [dismissedFindings, filter]);

  // Optimistic echo of the in-flight user message (history only updates after
  // the AI responds, which can take 10–15s).
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const handleSend = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    setPendingMessage(text);
    try {
      await sendMessage(text);
    } finally {
      setPendingMessage(null);
    }
  };

  // Keep the chat scrolled to the latest message: on tab switch to chat, on
  // open (history load), and whenever a message arrives (user echo or AI reply).
  const [activeTab, setActiveTab] = useState('full-review');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeTab !== 'chat') return;
    // Wait a frame so the just-shown chat panel has laid out (scrollHeight is 0
    // while hidden). rAF covers the tab-switch mount; the deps cover new messages.
    const id = requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab, messages, pendingMessage, isSending, isLoadingHistory]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList>
        <TabsTrigger value="full-review">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Full Review
        </TabsTrigger>
        {/* Tooltip wraps the tab's INNER content, not the TabsTrigger itself:
            both Radix primitives emit a `data-state` attribute, and merging
            TooltipTrigger onto the TabsTrigger via asChild lets the tooltip's
            data-state="closed" clobber the tab's data-state="active" — which
            kills the `data-[state=active]` active styling. Keeping them on
            separate elements preserves the active highlight. */}
        <TabsTrigger value="chat">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center">
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Chat
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Chat is for small, targeted questions — e.g. reviewing a single document or checking one
              requirement. For a complete audit of the whole package, use Full Review.
            </TooltipContent>
          </Tooltip>
        </TabsTrigger>
      </TabsList>

      {/* ── Full package review ──────────────────────────────────────────── */}
      <TabsContent value="full-review" className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">Full package review</h2>
            <p className="text-sm text-muted-foreground">
              Audit every document and form against the solicitation.
            </p>
          </div>
          <Button onClick={triggerReview} disabled={isRunning} className="shrink-0">
            {isRunning ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Reviewing…
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-4 w-4" />
                {status ? 'Re-run review' : 'Run full review'}
              </>
            )}
          </Button>
        </div>

        {stale && !isRunning && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              The package changed since this review ran. Re-run to refresh the findings.
            </AlertDescription>
          </Alert>
        )}

        {status === 'FAILED' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>The last review failed. Please run it again.</AlertDescription>
          </Alert>
        )}

        {isLoading || isRunning ? (
          <div className="space-y-3">
            {isRunning && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                Reviewing the whole package against the solicitation — this can take a minute.
              </div>
            )}
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !status ? (
          // Never run: a focal call-to-action, not a misleading "no issues found".
          <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/30 px-6 py-12 text-center">
            <div className="mb-3 rounded-full bg-primary/10 p-2.5">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">No review yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Run a full review to check the entire package against the solicitation — missing forms,
              inconsistencies, unaddressed requirements, and more.
            </p>
            <Button onClick={triggerReview} disabled={isRunning} className="mt-4">
              <Play className="mr-1.5 h-4 w-4" />
              Run full review
            </Button>
          </div>
        ) : (
          <>
            {/* Persistent focal summary — the "how bad is it?" answer stays visible
                whether or not the cards are expanded. Severity badges act as
                quick filters. */}
            {hasFindings && (
              <FindingsStats
                findings={activeFindings}
                activeSeverity={filter.severity === ALL ? null : filter.severity}
                onToggleSeverity={toggleSeverity}
              />
            )}

            {hasFindings && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFindingsCollapsed((v) => !v)}
                  aria-expanded={!findingsCollapsed}
                >
                  {findingsCollapsed ? (
                    <>
                      <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                      Show findings
                    </>
                  ) : (
                    <>
                      <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                      Collapse findings
                    </>
                  )}
                </Button>
                {!findingsCollapsed && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <FindingsFilterBar allFindings={allFindings} filter={filter} onChange={setFilter} />
                    <Button variant="ghost" size="sm" onClick={toggleAllDetails}>
                      {detailsExpanded ? (
                        <>
                          <ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />
                          Minimize all
                        </>
                      ) : (
                        <>
                          <ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />
                          Show details
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!findingsCollapsed && (
              <FindingsList
                activeFindings={filteredActive}
                dismissedFindings={filteredDismissed}
                resolvedFindings={filteredResolved}
                orgId={orgId}
                projectId={projectId}
                oppId={oppId}
                onDismiss={(fp) => setDecision(fp, 'dismissed')}
                onResolve={(fp) => setDecision(fp, 'resolved')}
                onReopen={(fp) => setDecision(fp, null)}
                defaultExpanded={detailsExpanded}
                expandSignal={expandSignal}
                filtered={isFilterActive(filter)}
              />
            )}
          </>
        )}
      </TabsContent>

      {/* ── Conversational review + edit ─────────────────────────────────── */}
      <TabsContent value="chat" className="space-y-3">
        <div
          ref={chatScrollRef}
          className="min-h-[280px] max-h-[520px] overflow-y-auto rounded-lg border bg-muted/30 p-4"
        >
          {isLoadingHistory ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Skeleton className="h-10 w-1/2 rounded-2xl" />
              </div>
              <div className="flex gap-2.5">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <Skeleton className="h-16 w-2/3 rounded-2xl" />
              </div>
            </div>
          ) : messages.length === 0 && !pendingMessage ? (
            // Empty state: an icon, one line of intent, and clickable starter
            // prompts that seed + send — removing blank-slate friction and
            // teaching what this surface does.
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 rounded-full bg-primary/10 p-2.5">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {canEdit ? 'Ask about the package — or request a change' : 'Ask about the package'}
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Targeted questions and edits. For a complete audit, run a Full Review.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[...CHAT_SUGGESTIONS_REVIEW, ...(canEdit ? CHAT_SUGGESTIONS_EDIT : [])].map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    onClick={() => void handleSend(s)}
                    // Suggestion chip: rounded-full pill styling kept over the
                    // outline variant via tailwind-merge.
                    className="h-auto rounded-full bg-background px-3 py-1.5 text-xs text-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.messageId} className="space-y-2">
                  <div className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {msg.role === 'assistant' && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[85%] px-3.5 py-2 text-sm whitespace-pre-wrap',
                        msg.role === 'user'
                          ? 'rounded-2xl rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-2xl rounded-bl-md border bg-card text-card-foreground shadow-sm',
                      )}
                    >
                      {msg.content}
                    </div>
                    {msg.role === 'user' && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Findings + edit runs align under the assistant bubble (avatar gutter). */}
                  {msg.role === 'assistant' && (msg.findings?.length || msg.editRunId) && (
                    <div className="space-y-2 pl-[38px]">
                      {msg.findings && msg.findings.length > 0 && (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Run a Full review to track and resolve findings.
                          </p>
                          <FindingsList
                            activeFindings={msg.findings.map((f) => ({ ...f }))}
                            orgId={orgId}
                            projectId={projectId}
                            oppId={oppId}
                            readOnly
                          />
                        </>
                      )}
                      {/* Most recent edit turn renders its proposal run inline (poll →
                          diff → apply); superseded older edit turns show a note.
                          Pass the message's editRunId so the view polls THIS run,
                          not whatever run is latest for the opportunity (which may
                          have been started from another surface — W2). */}
                      {msg.editRunId &&
                        (msg.editRunId === latestEditRunId ? (
                          <ProposalRunView orgId={orgId} projectId={projectId} oppId={oppId} runId={msg.editRunId} />
                        ) : (
                          <p className="text-xs italic text-muted-foreground">
                            This edit was superseded by a later request.
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              ))}

              {pendingMessage && (
                <div className="flex justify-end gap-2.5">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground opacity-70">
                    {pendingMessage}
                  </div>
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
              )}

              {isSending && (
                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border bg-card px-3.5 py-3 shadow-sm">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer: one bordered surface with a focus ring, so input + send read
            as a single control (not a textarea sitting next to a button). */}
        <div className="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-ring">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={canEdit ? 'Ask about the package, or request a change…' : "Ask about the package's compliance…"}
            rows={2}
            disabled={isSending}
            className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="text-xs text-muted-foreground">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-sans text-[10px]">Enter</kbd> to send ·{' '}
              <kbd className="rounded border bg-muted px-1 py-0.5 font-sans text-[10px]">Shift+Enter</kbd> for new line
            </span>
            <Button size="sm" onClick={() => void handleSend()} disabled={isSending || !input.trim()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
};
