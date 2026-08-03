'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, Loader2, MessageSquare, Play, Send, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useReviewRun } from '../hooks/useReviewRun';
import { useComplianceChat } from '../hooks/useComplianceChat';
import { useFindingDecisions } from '../hooks/useFindingDecisions';
import { FindingsList } from './FindingsList';
import { FindingsStats } from './FindingsStats';
import { FindingsFilterBar, applyFilter, emptyFilter, isFilterActive, type FindingsFilter } from './FindingsFilterBar';

interface ComplianceReviewPanelProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

export const ComplianceReviewPanel = ({ orgId, projectId, oppId }: ComplianceReviewPanelProps) => {
  const { findings, decisions, stale, isRunning, isLoading, triggerReview, refresh, status } =
    useReviewRun(orgId, projectId, oppId);
  const { messages, isLoadingHistory, sendMessage, isSending } = useComplianceChat(
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

  // Client-side filter by issue type + document (Full Review tab only).
  const [filter, setFilter] = useState<FindingsFilter>(emptyFilter);
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
  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
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
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="chat">
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Chat is for small, targeted questions — e.g. reviewing a single document or checking one
            requirement. For a complete audit of the whole package, use Full Review.
          </TooltipContent>
        </Tooltip>
      </TabsList>

      {/* ── Full package review ──────────────────────────────────────────── */}
      <TabsContent value="full-review" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Review the entire submission package against the solicitation.
          </p>
          <Button onClick={triggerReview} disabled={isRunning}>
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
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
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
            {findingsCollapsed ? (
              <FindingsStats findings={activeFindings} />
            ) : (
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

      {/* ── Conversational review ────────────────────────────────────────── */}
      <TabsContent value="chat" className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Chat is for small, targeted questions — e.g. reviewing a single document or checking one
          requirement. For a complete audit of the whole package, run a Full Review.
        </p>
        <div ref={chatScrollRef} className="space-y-3 max-h-[480px] overflow-y-auto">
          {isLoadingHistory ? (
            <>
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="h-16 w-2/3 ml-auto" />
            </>
          ) : messages.length === 0 && !pendingMessage ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Ask about the package&rsquo;s compliance — e.g. &ldquo;Does the technical volume address
              Section L? Which forms am I missing?&rdquo;
            </p>
          ) : (
            messages.map((msg) => (
              <div key={msg.messageId} className="space-y-2">
                <Card
                  className={
                    msg.role === 'user'
                      ? 'p-3 bg-muted ml-auto max-w-[85%]'
                      : 'p-3 max-w-[85%]'
                  }
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </Card>
                {msg.role === 'assistant' && msg.findings && msg.findings.length > 0 && (
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
              </div>
            ))
          )}
          {pendingMessage && (
            <div className="space-y-2">
              <Card className="p-3 bg-muted ml-auto max-w-[85%]">
                <p className="text-sm whitespace-pre-wrap">{pendingMessage}</p>
              </Card>
            </div>
          )}
          {isSending && <Skeleton className="h-16 w-2/3" />}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about the package's compliance…"
            rows={2}
            disabled={isSending}
          />
          <Button onClick={() => void handleSend()} disabled={isSending || !input.trim()}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
};
