'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { AlertTriangle, CalendarClock, Clock, FileText, ListChecks, Shield, Target, Users } from 'lucide-react';

import DeadlinesDashboard from '../deadlines/DeadlinesDashboard';
import { useProject } from '@/lib/hooks/use-api';

import {
  useGenerateExecutiveBriefContacts,
  useGenerateExecutiveBriefDeadlines,
  useGenerateExecutiveBriefRequirements,
  useGenerateExecutiveBriefRisks,
  useGenerateExecutiveBriefScoring,
  useGenerateExecutiveBriefSummary,
  useGetExecutiveBriefByProject,
  useInitExecutiveBrief,
  useHandleLinearTicket,
} from '@/lib/hooks/use-executive-brief';

import type { Props, SectionKey, SectionStatus } from './types';
import { SECTION_ORDER } from './types';
import { buildSectionsState, calcProgress, scoringPrereqsComplete } from './helpers';

import { HeaderCard } from './components/HeaderCard';
import { SectionsControlCard } from './components/SectionsControlCard';
import { ChangesSummary } from './components/ChangesSummary';

import { DecisionCard } from './components/DecisionCard';
import { ExecutiveCloseOutCard } from './components/ExecutiveCloseOutCard';
import { ScoringGrid } from './components/ScoringGrid';
import { RequirementsCard } from './components/RequirementsCard';
import { ContactsCard } from './components/ContactsCard';
import { RisksCard } from './components/RisksCard';
import { useOrganization } from '@/context/organization-context';

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
    case 'scoring':
      return 'Scoring';
  }
}

const IN_PROGRESS_STATUSES = new Set(['QUEUED', 'IN_PROGRESS', 'RUNNING', 'PENDING', 'STARTED']);

function isInProgressStatus(st?: string | null) {
  if (!st) return false;
  return IN_PROGRESS_STATUSES.has(String(st).toUpperCase());
}

export function ExecutiveBriefView({ projectId }: Props) {
  const { data: project, isLoading, isError, mutate: refetchProject } = useProject(projectId);
  const { currentOrganization } = useOrganization();
  const init = useInitExecutiveBrief(currentOrganization?.id);
  const genSummary = useGenerateExecutiveBriefSummary(currentOrganization?.id);
  const genDeadlines = useGenerateExecutiveBriefDeadlines(currentOrganization?.id);
  const genContacts = useGenerateExecutiveBriefContacts(currentOrganization?.id);
  const genRequirements = useGenerateExecutiveBriefRequirements(currentOrganization?.id);
  const genRisks = useGenerateExecutiveBriefRisks(currentOrganization?.id);
  const genScoring = useGenerateExecutiveBriefScoring(currentOrganization?.id);
  const getBriefByProject = useGetExecutiveBriefByProject();
  const handleLinearTicket = useHandleLinearTicket();

  const [regenError, setRegenError] = useState<string | null>(null);
  const [previousBrief, setPreviousBrief] = useState<any>(null);
  const [briefItem, setBriefItem] = useState<any>(null);
  const [localBusySections, setLocalBusySections] = useState<Set<SectionKey>>(() => new Set());
  const [hasTriedLinearTicket, setHasTriedLinearTicket] = useState(false);
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
      const label = local.length ? `${inProgressSections.concat(local).join(', ')}` : inProgressSections.join(', ');
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
        // if backend says NOT in progress anymore, drop optimistic busy
        if (!isInProgressStatus(st)) next.delete(k);
      }
      return next;
    });
  }, [briefItem?.updatedAt]); // key off updatedAt to avoid constant recompute

  function markBusy(keys: SectionKey[]) {
    setLocalBusySections((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }

  function startPollingBrief() {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const resp = await getBriefByProject.trigger({ projectId });
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
            !linearTicketAttemptedRef.current
          ) {
            linearTicketAttemptedRef.current = true;
            try {
              console.log('Auto-creating Linear ticket after scoring:', decision);
              console.log(resp.brief)
              await handleLinearTicket.trigger({ executiveBriefId: String(executiveBriefId) });
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

  useEffect(() => {
    (async () => {
      try {
        const resp = await getBriefByProject.trigger({ projectId });
        if (resp?.ok && resp?.brief) setBriefItem(resp.brief);
      } catch {
        // ignore
      }
    })();

    return () => stopPollingBrief();
  }, [projectId]);

  useEffect(() => {
    localBusySectionsRef.current = localBusySections;
  }, [localBusySections]);

  async function ensureBriefId(): Promise<string> {
    if (project?.executiveBriefId) return project.executiveBriefId;

    const resp = await init.trigger({ projectId });
    await refetchProject();

    if (!resp?.ok || !resp.executiveBriefId) {
      throw new Error(resp?.error || 'Failed to initialize executive brief');
    }

    return resp.executiveBriefId;
  }

  async function enqueueSection(section: SectionKey, executiveBriefId: string) {
    switch (section) {
      case 'summary':
        return genSummary.trigger({ executiveBriefId });
      case 'deadlines':
        return genDeadlines.trigger({ executiveBriefId });
      case 'contacts':
        return genContacts.trigger({ executiveBriefId });
      case 'requirements':
        return genRequirements.trigger({ executiveBriefId });
      case 'risks':
        return genRisks.trigger({ executiveBriefId });
      case 'scoring':
        return genScoring.trigger({ executiveBriefId });
    }
  }

  async function generateBrief(onlyMissing: boolean) {
    setRegenError(null);
    linearTicketAttemptedRef.current = false;
    if (!project) return;
    if (briefItem) setPreviousBrief(briefItem);

    try {
      const executiveBriefId = await ensureBriefId();

      const latest = await getBriefByProject.trigger({ projectId });
      const currentBrief = latest?.ok && latest?.brief ? latest.brief : briefItem;

      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);

      const toRun: SectionKey[] = onlyMissing
        ? SECTION_ORDER.filter((k) => {
          const st = (currentBrief?.sections as any)?.[k]?.status as SectionStatus | undefined;
          return st !== 'COMPLETE';
        })
        : SECTION_ORDER;

      markBusy(toRun);
      startPollingBrief();

      // enqueue fast in parallel
      await Promise.all(toRun.map((k) => enqueueSection(k, executiveBriefId)));

      const after = await getBriefByProject.trigger({ projectId });
      if (after?.ok && after?.brief) setBriefItem(after.brief);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
    }
  }

  async function runOneSection(section: SectionKey) {
    setRegenError(null);
    try {
      const executiveBriefId = await ensureBriefId();

      markBusy([section]);
      startPollingBrief();

      await enqueueSection(section, executiveBriefId);

      const latest = await getBriefByProject.trigger({ projectId });
      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Executive Opportunity Brief</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 animate-spin"/>
          Loading…
        </CardContent>
      </Card>
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

  return (
    <div className="space-y-6">
      <HeaderCard
        projectName={project.name}
        briefItem={briefItem}
        regenError={regenError}
        sectionsState={sectionsState as any}
        sectionIcon={sectionIcon}
        prereqMissing={!prereq.ok ? prereq.missing : []}
        progressPercent={progressPercent}
        progressText={progressText}
        onQueueMissing={() => generateBrief(true)}
        onQueueAll={() => generateBrief(false)}
        queueDisabled={anySectionInProgress}
      />

      {!briefItem ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4"/>
            <p className="text-sm text-muted-foreground">
              No executive brief yet. Click <span className="font-semibold">Generate Brief</span> to start the worker.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {previousBrief && <ChangesSummary previous={previousBrief} current={briefItem}/>}

          <SectionsControlCard
            sectionOrder={SECTION_ORDER}
            briefItem={briefItem}
            prereq={prereq}
            sectionIcon={sectionIcon}
            sectionTitle={sectionTitle}
            onQueueSection={(k) => runOneSection(k)}
            isSectionBusy={isSectionBusy}
          />

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

          <DeadlinesDashboard projectId={projectId} orgId={project.orgId} key={briefItem?.updatedAt || 'no-brief'}/>

          <RequirementsCard requirements={requirements}/>
          <ContactsCard contacts={contacts}/>
          <RisksCard risks={risks}/>
        </>
      )}
    </div>
  );
}