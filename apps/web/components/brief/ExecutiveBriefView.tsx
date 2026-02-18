'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

import { AlertTriangle, Briefcase, CalendarClock, CheckCircle2, Clock, Download, FileSearch, FileText, ListChecks, Loader2, RefreshCw, Shield, Target, Users, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

import DeadlinesDashboard from '../deadlines/DeadlinesDashboard';
import { useProject } from '@/lib/hooks/use-api';

import {
  useGenerateExecutiveBriefContacts,
  useGenerateExecutiveBriefDeadlines,
  useGenerateExecutiveBriefRequirements,
  useGenerateExecutiveBriefRisks,
  useGenerateExecutiveBriefPastPerformance,
  useGenerateExecutiveBriefScoring,
  useGenerateExecutiveBriefSummary,
  useGetExecutiveBriefByProject,
  useInitExecutiveBrief,
  useHandleLinearTicket,
} from '@/lib/hooks/use-executive-brief';

import type { SectionKey, SectionStatus } from './types';
import { SECTION_ORDER } from './types';
import { buildSectionsState, calcProgress, exportBriefAsDocx, scoringPrereqsComplete } from './helpers';

import { ChangesSummary } from './components/ChangesSummary';

import { DecisionCard } from './components/DecisionCard';
import { ExecutiveCloseOutCard } from './components/ExecutiveCloseOutCard';
import { ScoringGrid } from './components/ScoringGrid';
import { RequirementsCard } from './components/RequirementsCard';
import { ContactsCard } from './components/ContactsCard';
import { RisksCard } from './components/RisksCard';
import { PastPerformanceCard } from './components/PastPerformanceCard';
import { GapAnalysisCard } from './components/GapAnalysisCard';
import { OpportunitySelector } from './components/OpportunitySelector';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectOutcome } from '@/lib/hooks/use-project-outcome';
import type { OpportunityItem } from '@auto-rfp/core';

function sectionIcon(section: SectionKey) {
  switch (section) {
    case 'summary':
      return <FileText className="h-4 w-4"/>;
    case 'deadlines':
      return <CalendarClock className="h-4 w-4"/>;
    case 'contacts':
      return <Users className="h-4 w-4"/>;
    case 'requirements':
      return <ListChecks className="h-4 w-4"/>;
    case 'risks':
      return <Shield className="h-4 w-4"/>;
    case 'pastPerformance':
      return <Briefcase className="h-4 w-4"/>;
    case 'scoring':
      return <Target className="h-4 w-4"/>;
  }
}

function sectionTitle(section: SectionKey) {
  switch (section) {
    case 'summary':
      return 'Summary';
    case 'deadlines':
      return 'Deadlines';
    case 'contacts':
      return 'Contacts';
    case 'requirements':
      return 'Requirements';
    case 'risks':
      return 'Risks';
    case 'pastPerformance':
      return 'Past Performance';
    case 'scoring':
      return 'Scoring';
  }
}

const IN_PROGRESS_STATUSES = new Set(['QUEUED', 'IN_PROGRESS', 'RUNNING', 'PENDING', 'STARTED']);

function isInProgressStatus(st?: string | null) {
  if (!st) return false;
  return IN_PROGRESS_STATUSES.has(String(st).toUpperCase());
}

// Tab configuration
const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText, section: 'summary' as SectionKey },
  { id: 'deadlines', label: 'Deadlines', icon: CalendarClock, section: 'deadlines' as SectionKey },
  { id: 'requirements', label: 'Requirements', icon: ListChecks, section: 'requirements' as SectionKey },
  { id: 'contacts', label: 'Contacts', icon: Users, section: 'contacts' as SectionKey },
  { id: 'risks', label: 'Risks', icon: Shield, section: 'risks' as SectionKey },
  { id: 'pastPerformance', label: 'Past Performance', icon: Briefcase, section: 'pastPerformance' as SectionKey },
  { id: 'scoring', label: 'Scoring', icon: Target, section: 'scoring' as SectionKey },
] as const;

type TabId = typeof TABS[number]['id'];

// Section Generate Button Component
interface SectionGenerateButtonProps {
  section: SectionKey;
  status?: string;
  isBusy: boolean;
  onGenerate: () => void;
  label?: string;
}

function SectionGenerateButton({ section, status, isBusy, onGenerate, label }: SectionGenerateButtonProps) {
  const isComplete = status === 'COMPLETE';
  const isInProgress = isInProgressStatus(status) || isBusy;
  
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onGenerate}
    >
      {isInProgress ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
          Generating...
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 mr-2"/>
          {isComplete ? `Regenerate ${label || sectionTitle(section)}` : `Generate ${label || sectionTitle(section)}`}
        </>
      )}
    </Button>
  );
}

// Section Content Wrapper - handles loading, error, and content states
interface SectionContentProps {
  section: SectionKey;
  status?: string;
  error?: string | null;
  isBusy: boolean;
  children: React.ReactNode;
  skeletonRows?: number;
}

function SectionContent({ section, status, error, isBusy, children, skeletonRows = 4 }: SectionContentProps) {
  const isFailed = status === 'FAILED';
  // Only show in-progress if NOT failed - failed status takes priority
  const isInProgress = !isFailed && (isInProgressStatus(status) || isBusy);

  // Show error if failed (check this FIRST, before in-progress)
  if (isFailed) {
    return (
      <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600"/>
            <CardTitle className="text-lg text-red-700 dark:text-red-400">
              {sectionTitle(section)} Generation Failed
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4"/>
            <AlertDescription className="whitespace-pre-wrap">
              {error || 'An unknown error occurred while generating this section.'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Show skeleton while in progress
  if (isInProgress) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600"/>
            <CardTitle className="text-lg">Generating {sectionTitle(section)}...</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(skeletonRows)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full"/>
              <Skeleton className="h-4 w-3/4"/>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // Show content
  return <>{children}</>;
}

interface ExecutiveBriefViewProps {
  projectId: string;
  initialOpportunityId?: string;
}

export function ExecutiveBriefView({ projectId, initialOpportunityId }: ExecutiveBriefViewProps) {
  const { data: project, isLoading, isError, mutate: refetchProject } = useProject(projectId);
  const { currentOrganization } = useCurrentOrganization();
  const { outcome: projectOutcome } = useProjectOutcome(project?.orgId ?? null, projectId);
  const init = useInitExecutiveBrief(currentOrganization?.id);
  const genSummary = useGenerateExecutiveBriefSummary(currentOrganization?.id);
  const genDeadlines = useGenerateExecutiveBriefDeadlines(currentOrganization?.id);
  const genContacts = useGenerateExecutiveBriefContacts(currentOrganization?.id);
  const genRequirements = useGenerateExecutiveBriefRequirements(currentOrganization?.id);
  const genRisks = useGenerateExecutiveBriefRisks(currentOrganization?.id);
  const genPastPerformance = useGenerateExecutiveBriefPastPerformance(currentOrganization?.id);
  const genScoring = useGenerateExecutiveBriefScoring(currentOrganization?.id);
  const getBriefByProject = useGetExecutiveBriefByProject(currentOrganization?.id);
  const handleLinearTicket = useHandleLinearTicket(currentOrganization?.id);

  const [regenError, setRegenError] = useState<string | null>(null);
  const [previousBrief, setPreviousBrief] = useState<any>(null);
  const [briefItem, setBriefItem] = useState<any>(null);
  const [localBusySections, setLocalBusySections] = useState<Set<SectionKey>>(() => new Set());
  const [isPastPerfRegenerating, setIsPastPerfRegenerating] = useState(false);
  const [isFetchingBrief, setIsFetchingBrief] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(initialOpportunityId ?? null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityItem | null>(null);
  const localBusySectionsRef = useRef<Set<SectionKey>>(new Set());
  const linearTicketAttemptedRef = useRef(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const sectionsState = useMemo(() => buildSectionsState(briefItem), [briefItem]);
  const totalSections = 6;

  const { completed: completedSections, percent: progressPercent, inProgress: inProgressSections } = useMemo(
    () => calcProgress(sectionsState as any, totalSections),
    [sectionsState],
  );

  const prereq = briefItem ? scoringPrereqsComplete(briefItem) : ({ ok: false, missing: [] as string[] });

  const progressText = useMemo(() => {
    if (!briefItem) return null;
    if (inProgressSections.length || localBusySections.size) {
      const local = Array.from(localBusySections);
      const allSections = inProgressSections.concat(local);
      const uniqueSections = Array.from(new Set(allSections));
      const label = uniqueSections.join(', ');
      return `Working on: ${label}`;
    }
    if (completedSections === totalSections) return 'All sections complete';
    return `Completed ${completedSections}/${totalSections}`;
  }, [briefItem, inProgressSections, completedSections, localBusySections]);

  const isSectionBusy = useMemo(() => {
    const sections = briefItem?.sections as Record<string, any> | undefined;
    return (k: SectionKey) => {
      if (localBusySections.has(k)) return true;
      const st = sections?.[k]?.status as string | undefined;
      return isInProgressStatus(st);
    };
  }, [briefItem, localBusySections]);

  const anySectionInProgress = useMemo(() => {
    if (localBusySections.size) return true;
    const sections = briefItem?.sections as Record<string, any> | undefined;
    if (!sections) return false;
    return SECTION_ORDER.some((k) => isInProgressStatus(sections?.[k]?.status));
  }, [briefItem, localBusySections]);

  // Get section status for tab badges
  const getSectionStatus = (tabId: TabId): 'complete' | 'in-progress' | 'failed' | 'pending' | null => {
    if (!briefItem?.sections) return null;
    
    const tab = TABS.find(t => t.id === tabId);
    if (!tab?.section) return null;
    
    const status = briefItem.sections[tab.section]?.status;
    if (status === 'COMPLETE') return 'complete';
    if (status === 'FAILED') return 'failed';
    if (isInProgressStatus(status)) return 'in-progress';
    return 'pending';
  };

  // Get section error message
  const getSectionError = (section: SectionKey): string | null => {
    if (!briefItem?.sections) return null;
    const sectionData = briefItem.sections[section];
    if (sectionData?.status === 'FAILED' && sectionData?.error) {
      return sectionData.error;
    }
    return null;
  };

  useEffect(() => {
    if (anySectionInProgress && !pollingRef.current) startPollingBrief();
  }, [anySectionInProgress]);

  useEffect(() => {
    if (!briefItem?.sections) return;
    const sections = briefItem.sections as Record<string, any>;

    setLocalBusySections((prev) => {
      if (!prev.size) return prev;

      const next = new Set(prev);
      for (const k of next) {
        const st = sections?.[k]?.status as string | undefined;
        if (!isInProgressStatus(st)) next.delete(k);
      }
      return next;
    });
  }, [briefItem?.updatedAt]);

  function markBusy(keys: SectionKey[]) {
    setLocalBusySections((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }

  // Store selectedOpportunityId in a ref for use in polling
  const selectedOpportunityIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    selectedOpportunityIdRef.current = selectedOpportunityId;
  }, [selectedOpportunityId]);

  function startPollingBrief() {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const currentOppId = selectedOpportunityIdRef.current;
        const resp = await getBriefByProject.trigger({ 
          projectId, 
          opportunityId: currentOppId || undefined 
        });
        if (resp?.ok && resp?.brief) {
          setBriefItem(resp.brief);

          const st = resp.brief.status;
          const allTerminal = SECTION_ORDER.every((k) =>
            ['COMPLETE', 'FAILED'].includes(resp.brief?.sections?.[k]?.status as string),
          );

          const locallyBusy = localBusySectionsRef.current.size > 0;

          const scoringComplete = resp.brief.sections?.scoring?.status === 'COMPLETE';
          const decision = resp.brief.decision || resp.brief.sections?.scoring?.data?.decision;
          const executiveBriefId = resp.brief.sort_key;
          
          if (
            scoringComplete && 
            decision && 
            !resp.brief.linearTicketId && 
            !linearTicketAttemptedRef.current &&
            executiveBriefId
          ) {
            linearTicketAttemptedRef.current = true;
            try {
              await handleLinearTicket.trigger({ executiveBriefId: String(executiveBriefId) });

              const withTicket = await getBriefByProject.trigger({ 
                projectId, 
                opportunityId: currentOppId || undefined 
              });
              if (withTicket?.ok && withTicket?.brief) {
                setBriefItem(withTicket.brief);
              }
            } catch (err) {
              console.error('Failed to auto-create Linear ticket:', err);
            }
          }

          if (!locallyBusy && (st === 'COMPLETE' || st === 'FAILED' || allTerminal)) {
            stopPollingBrief();
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
  }

  function stopPollingBrief() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  // Handle opportunity selection change - fetch brief for selected opportunity
  const handleOpportunitySelect = async (oppId: string | null, opp: OpportunityItem | null) => {
    setSelectedOpportunityId(oppId);
    setSelectedOpportunity(opp);
    setBriefItem(null);
    setPreviousBrief(null);
    setRegenError(null);
    
    if (oppId) {
      setIsFetchingBrief(true);
      try {
        const resp = await getBriefByProject.trigger({ projectId, opportunityId: oppId });
        if (resp?.ok && resp?.brief) {
          setBriefItem(resp.brief);
        }
      } catch (err: any) {
        // No brief exists for this opportunity yet - that's ok, don't show error
        // The UI will show the "Generate All Sections" button
        console.log('No brief found for opportunity, user can generate one:', err?.message);
      } finally {
        setIsFetchingBrief(false);
      }
    }
  };

  useEffect(() => {
    // Only fetch if we have an opportunity selected
    if (!selectedOpportunityId) {
      setBriefItem(null);
      return;
    }

    setIsFetchingBrief(true);
    (async () => {
      try {
        // Fetch brief for the selected opportunity
        const resp = await getBriefByProject.trigger({ 
          projectId, 
          opportunityId: selectedOpportunityId 
        });
        if (resp?.ok && resp?.brief) setBriefItem(resp.brief);
      } catch (err: any) {
        // No brief exists for this opportunity yet - that's ok
        // The UI will show the "Generate All Sections" button
        console.log('No brief found for opportunity:', err?.message);
        setBriefItem(null);
      } finally {
        setIsFetchingBrief(false);
      }
    })();

    return () => stopPollingBrief();
  }, [projectId, selectedOpportunityId]);

  useEffect(() => {
    localBusySectionsRef.current = localBusySections;
  }, [localBusySections]);

  async function ensureBriefId(): Promise<string> {
    // Check if we already have a brief for this opportunity
    if (briefItem?.sort_key) return briefItem.sort_key;
    
    // For opportunity-specific briefs, we need to initialize a new one
    const resp = await init.trigger({ 
      projectId, 
      opportunityId: selectedOpportunityId || '' 
    });
    await refetchProject();

    if (!resp?.ok || !resp.executiveBriefId) {
      throw new Error(resp?.error || 'Failed to initialize executive brief');
    }

    return resp.executiveBriefId;
  }

  async function enqueueSection(section: SectionKey, executiveBriefId: string) {
    let resp: any;
    switch (section) {
      case 'summary':
        resp = await genSummary.trigger({ executiveBriefId });
        break;
      case 'deadlines':
        resp = await genDeadlines.trigger({ executiveBriefId });
        break;
      case 'contacts':
        resp = await genContacts.trigger({ executiveBriefId });
        break;
      case 'requirements':
        resp = await genRequirements.trigger({ executiveBriefId });
        break;
      case 'risks':
        resp = await genRisks.trigger({ executiveBriefId });
        break;
      case 'pastPerformance':
        resp = await genPastPerformance.trigger({ executiveBriefId });
        break;
      case 'scoring':
        resp = await genScoring.trigger({ executiveBriefId });
        break;
    }
    
    // Check if the API returned an error (ok: false)
    if (resp && resp.ok === false && resp.error) {
      throw new Error(resp.error);
    }
    
    return resp;
  }

  async function generateBrief(onlyMissing: boolean) {
    setRegenError(null);
    linearTicketAttemptedRef.current = false;
    if (!project) return;
    if (briefItem) setPreviousBrief(briefItem);

    let sectionsToRun: SectionKey[] = [];
    
    try {
      const executiveBriefId = await ensureBriefId();

      const latest = await getBriefByProject.trigger({ 
        projectId, 
        opportunityId: selectedOpportunityId || undefined 
      });
      const currentBrief = latest?.ok && latest?.brief ? latest.brief : briefItem;

      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);

      sectionsToRun = onlyMissing
        ? SECTION_ORDER.filter((k) => {
          const st = (currentBrief?.sections as any)?.[k]?.status as SectionStatus | undefined;
          return st !== 'COMPLETE';
        })
        : SECTION_ORDER;

      // Separate scoring from other sections - scoring should run after all others complete
      const sectionsWithoutScoring = sectionsToRun.filter((k) => k !== 'scoring');
      const shouldRunScoring = sectionsToRun.includes('scoring');

      markBusy(sectionsToRun);
      startPollingBrief();

      // Phase 1: Run all sections except scoring in parallel
      if (sectionsWithoutScoring.length > 0) {
        await Promise.all(sectionsWithoutScoring.map((k) => enqueueSection(k, executiveBriefId)));
      }

      // Phase 2: Wait for all prerequisite sections to complete before running scoring
      if (shouldRunScoring) {
        // Poll until all prerequisite sections are complete
        const maxWaitTime = 120000; // 2 minutes max wait
        const pollInterval = 2000; // Check every 2 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          const checkResp = await getBriefByProject.trigger({ 
            projectId, 
            opportunityId: selectedOpportunityId || undefined 
          });
          
          if (checkResp?.ok && checkResp?.brief) {
            setBriefItem(checkResp.brief);
            
            // Check if all prerequisite sections are complete
            const prereqSections: SectionKey[] = ['summary', 'requirements', 'risks', 'pastPerformance'];
            const allPrereqsComplete = prereqSections.every((k) => {
              const status = checkResp.brief?.sections?.[k]?.status;
              return status === 'COMPLETE' || status === 'FAILED';
            });

            if (allPrereqsComplete) {
              // Now run scoring
              await enqueueSection('scoring', executiveBriefId);
              break;
            }
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      const after = await getBriefByProject.trigger({ 
        projectId, 
        opportunityId: selectedOpportunityId || undefined 
      });
      if (after?.ok && after?.brief) setBriefItem(after.brief);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
      // Clear busy sections on error so buttons aren't stuck disabled
      setLocalBusySections(new Set());
      stopPollingBrief();
    }
  }

  async function runOneSection(section: SectionKey) {
    setRegenError(null);
    try {
      const executiveBriefId = await ensureBriefId();

      markBusy([section]);
      startPollingBrief();

      await enqueueSection(section, executiveBriefId);

      const latest = await getBriefByProject.trigger({ 
        projectId, 
        opportunityId: selectedOpportunityId || undefined 
      });
      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-40"/>
            <Skeleton className="h-6 w-24"/>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-36"/>
            <Skeleton className="h-9 w-32"/>
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="flex gap-1">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-10 rounded-md"/>
          ))}
        </div>

        {/* Content skeleton */}
        <div className="space-y-6 mt-6">
          {/* Decision card skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48"/>
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full"/>
              <Skeleton className="h-4 w-3/4"/>
              <Skeleton className="h-4 w-1/2"/>
            </CardContent>
          </Card>

          {/* Scoring grid skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32"/>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-24"/>
                    <Skeleton className="h-8 w-16"/>
                    <Skeleton className="h-2 w-full"/>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Executive Opportunity Brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4"/>
            <AlertDescription>Failed to load project</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => refetchProject()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = briefItem?.sections?.summary?.data;
  const scoring = briefItem?.sections?.scoring?.data;
  const requirements = briefItem?.sections?.requirements?.data;
  const contacts = briefItem?.sections?.contacts?.data;
  const risks = briefItem?.sections?.risks?.data;
  const pastPerformance = (briefItem?.sections as any)?.pastPerformance?.data;

  return (
    <div className="space-y-6">
      {/* Opportunity Selector - Compact inline version */}
      <div className="flex items-center gap-3">
        <Label className="text-sm font-medium whitespace-nowrap">Opportunity:</Label>
        <div className="flex-1 max-w-md">
          <OpportunitySelector
            projectId={projectId}
            orgId={currentOrganization?.id ?? null}
            selectedOpportunityId={selectedOpportunityId}
            onSelect={handleOpportunitySelect}
            disabled={anySectionInProgress}
          />
        </div>
        {selectedOpportunity && (
          <div className="flex flex-wrap gap-1.5">
            {selectedOpportunity.solicitationNumber && (
              <Badge variant="secondary" className="text-xs">
                {selectedOpportunity.solicitationNumber}
              </Badge>
            )}
            {selectedOpportunity.naicsCode && (
              <Badge variant="outline" className="text-xs">
                NAICS: {selectedOpportunity.naicsCode}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Show message if no opportunity selected */}
      {!selectedOpportunityId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4"/>
            <p className="text-sm text-muted-foreground">
              Select an opportunity above to generate an executive brief.
            </p>
          </CardContent>
        </Card>
      ) : isFetchingBrief ? (
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-40"/>
              <Skeleton className="h-6 w-24 rounded-full"/>
              <Skeleton className="h-5 w-36"/>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-36"/>
              <Skeleton className="h-9 w-32"/>
            </div>
          </div>

          {/* Tabs skeleton */}
          <div className="flex gap-1 p-1">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-10 rounded-md"/>
            ))}
          </div>

          {/* Content skeleton */}
          <div className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48"/>
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full"/>
                <Skeleton className="h-4 w-3/4"/>
                <Skeleton className="h-4 w-1/2"/>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32"/>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24"/>
                      <Skeleton className="h-8 w-16"/>
                      <Skeleton className="h-2 w-full"/>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : !briefItem ? (
        <div className="space-y-4">
          {/* Show error if generation failed before brief was created */}
          {regenError && (
            <Alert variant={regenError.includes('No processed question files') ? 'default' : 'destructive'}>
              {regenError.includes('No processed question files') ? (
                <Clock className="h-4 w-4"/>
              ) : (
                <AlertTriangle className="h-4 w-4"/>
              )}
              <AlertDescription>
                {regenError.includes('ExecutiveBrief not found') 
                  ? 'Unable to generate brief. Please try clicking "Generate All Sections" to initialize the executive brief first.'
                  : regenError.includes('No processed question files')
                  ? (
                    <div className="space-y-2">
                      <p className="font-medium">Documents are still being processed</p>
                      <p className="text-sm">
                        Uploaded solicitation files need to complete text extraction before the executive brief can be generated. 
                        This typically takes 1-3 minutes depending on document size.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Please wait for processing to complete, then try generating again.
                      </p>
                    </div>
                  )
                  : regenError}
              </AlertDescription>
            </Alert>
          )}
          
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4"/>
              <p className="text-sm text-muted-foreground mb-4">
                No executive brief yet for this opportunity. Generate all sections to analyze it.
              </p>
              <Button onClick={() => generateBrief(false)} disabled={anySectionInProgress}>
                {anySectionInProgress ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2"/>
                    Generate All Sections
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {previousBrief && <ChangesSummary previous={previousBrief} current={briefItem}/>}

          {/* Header with Generate All button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Executive Brief</h2>
              <Badge variant={completedSections === totalSections ? 'default' : 'secondary'}>
                {completedSections}/{totalSections} sections
              </Badge>
              {progressText && (
                <span className="text-sm text-muted-foreground">{progressText}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportBriefAsDocx(project.name, briefItem)}
                className="gap-2"
              >
                <Download className="h-4 w-4"/>
                Export DOCX
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => generateBrief(true)} 
                disabled={anySectionInProgress}
              >
                {anySectionInProgress ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2"/>
                    Generate Missing
                  </>
                )}
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => generateBrief(false)} 
                disabled={anySectionInProgress}
              >
                {anySectionInProgress ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2"/>
                    Regenerate All
                  </>
                )}
              </Button>
            </div>
          </div>

          {regenError && (
            <Alert variant={regenError.includes('No processed question files') ? 'default' : 'destructive'}>
              {regenError.includes('No processed question files') ? (
                <Clock className="h-4 w-4"/>
              ) : (
                <AlertTriangle className="h-4 w-4"/>
              )}
              <AlertDescription>
                {regenError.includes('ExecutiveBrief not found') 
                  ? 'Unable to generate brief. Please try clicking "Generate All Sections" to initialize the executive brief first.'
                  : regenError.includes('No processed question files')
                  ? (
                    <div className="space-y-2">
                      <p className="font-medium">Documents are still being processed</p>
                      <p className="text-sm">
                        Uploaded solicitation files need to complete text extraction before the executive brief can be generated. 
                        This typically takes 1-3 minutes depending on document size.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Please wait for processing to complete, then try generating again.
                      </p>
                    </div>
                  )
                  : regenError}
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="w-full">
            <TabsList className="w-full h-auto p-1 flex flex-wrap gap-1">
              {TABS.map((tab) => {
                const status = getSectionStatus(tab.id);
                const Icon = tab.icon;
                return (
                  <TabsTrigger 
                    key={tab.id} 
                    value={tab.id}
                    className="group flex items-center gap-1.5 py-2 px-2 text-sm data-[state=active]:bg-background transition-all duration-200 hover:px-3"
                    title={tab.label}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0"/>
                    <span className="max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-[120px] group-data-[state=active]:max-w-[120px] transition-all duration-200">
                      {tab.label}
                    </span>
                    {status === 'complete' && (
                      <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0"/>
                    )}
                    {status === 'in-progress' && (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-600 flex-shrink-0"/>
                    )}
                    {status === 'failed' && (
                      <XCircle className="h-3 w-3 text-red-600 flex-shrink-0"/>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="summary"
                  status={briefItem?.sections?.summary?.status}
                  isBusy={isSectionBusy('summary')}
                  onGenerate={() => runOneSection('summary')}
                  label="Overview"
                />
              </div>
              <SectionContent
                section="summary"
                status={briefItem?.sections?.summary?.status}
                error={getSectionError('summary')}
                isBusy={isSectionBusy('summary')}
                skeletonRows={5}
              >
                <DecisionCard 
                  projectName={project.name}
                  projectId={projectId}  
                  summary={summary}
                  briefItem={briefItem}
                  previousBrief={previousBrief}
                  onBriefUpdate={(brief) => setBriefItem(brief)}  
                />
                <ExecutiveCloseOutCard scoring={scoring}/>
                <ScoringGrid scoring={scoring}/>
              </SectionContent>
            </TabsContent>

            {/* Deadlines Tab */}
            <TabsContent value="deadlines" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="deadlines"
                  status={briefItem?.sections?.deadlines?.status}
                  isBusy={isSectionBusy('deadlines')}
                  onGenerate={() => runOneSection('deadlines')}
                />
              </div>
              <SectionContent
                section="deadlines"
                status={briefItem?.sections?.deadlines?.status}
                error={getSectionError('deadlines')}
                isBusy={isSectionBusy('deadlines')}
                skeletonRows={6}
              >
                <DeadlinesDashboard 
                  projectId={projectId} 
                  orgId={project.orgId} 
                  key={briefItem?.updatedAt || 'no-brief'}
                />
              </SectionContent>
            </TabsContent>

            {/* Requirements Tab */}
            <TabsContent value="requirements" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="requirements"
                  status={briefItem?.sections?.requirements?.status}
                  isBusy={isSectionBusy('requirements')}
                  onGenerate={() => runOneSection('requirements')}
                />
              </div>
              <SectionContent
                section="requirements"
                status={briefItem?.sections?.requirements?.status}
                error={getSectionError('requirements')}
                isBusy={isSectionBusy('requirements')}
                skeletonRows={8}
              >
                <RequirementsCard requirements={requirements}/>
              </SectionContent>
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="contacts"
                  status={briefItem?.sections?.contacts?.status}
                  isBusy={isSectionBusy('contacts')}
                  onGenerate={() => runOneSection('contacts')}
                />
              </div>
              <SectionContent
                section="contacts"
                status={briefItem?.sections?.contacts?.status}
                error={getSectionError('contacts')}
                isBusy={isSectionBusy('contacts')}
                skeletonRows={4}
              >
                <ContactsCard contacts={contacts}/>
              </SectionContent>
            </TabsContent>

            {/* Risks Tab */}
            <TabsContent value="risks" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="risks"
                  status={briefItem?.sections?.risks?.status}
                  isBusy={isSectionBusy('risks')}
                  onGenerate={() => runOneSection('risks')}
                />
              </div>
              <SectionContent
                section="risks"
                status={briefItem?.sections?.risks?.status}
                error={getSectionError('risks')}
                isBusy={isSectionBusy('risks')}
                skeletonRows={5}
              >
                <RisksCard risks={risks}/>
              </SectionContent>
            </TabsContent>

            {/* Past Performance Tab */}
            <TabsContent value="pastPerformance" className="space-y-6 mt-6">
              <SectionContent
                section="pastPerformance"
                status={briefItem?.sections?.pastPerformance?.status}
                error={getSectionError('pastPerformance')}
                isBusy={isSectionBusy('pastPerformance') || isPastPerfRegenerating}
                skeletonRows={6}
              >
                <PastPerformanceCard 
                  pastPerformance={pastPerformance}
                  onRegenerate={async (force) => {
                    setIsPastPerfRegenerating(true);
                    try {
                      const executiveBriefId = await ensureBriefId();
                      await genPastPerformance.trigger({ executiveBriefId, force });
                      const latest = await getBriefByProject.trigger({ 
                        projectId, 
                        opportunityId: selectedOpportunityId || undefined 
                      });
                      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);
                    } catch (e: any) {
                      setRegenError(e?.message ?? 'Failed to regenerate past performance');
                    } finally {
                      setIsPastPerfRegenerating(false);
                    }
                  }}
                  isRegenerating={isPastPerfRegenerating}
                />
                <GapAnalysisCard gapAnalysis={pastPerformance?.gapAnalysis}/>
              </SectionContent>
            </TabsContent>

            {/* Scoring Tab */}
            <TabsContent value="scoring" className="space-y-6 mt-6">
              <div className="flex justify-end">
                <SectionGenerateButton
                  section="scoring"
                  status={briefItem?.sections?.scoring?.status}
                  isBusy={isSectionBusy('scoring')}
                  onGenerate={() => runOneSection('scoring')}
                />
              </div>
              <SectionContent
                section="scoring"
                status={briefItem?.sections?.scoring?.status}
                error={getSectionError('scoring')}
                isBusy={isSectionBusy('scoring')}
                skeletonRows={6}
              >
                <ScoringGrid scoring={scoring}/>
              </SectionContent>
            </TabsContent>

          </Tabs>
        </>
      )}
    </div>
  );
}