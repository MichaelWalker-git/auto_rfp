'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  FileSearch,
  FileText,
  FolderOpen,
  HelpCircle,
  Target,
  XCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useProject, useQuestions } from '@/lib/hooks/use-api';
import { useProjectOutcomes } from '@/lib/hooks/use-project-outcome';
import { useGetExecutiveBriefByProject } from '@/lib/hooks/use-executive-brief';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import {
  NoRfpDocumentAvailable,
  useQuestions as useQuestionsProvider,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks/use-api';
import { env } from '@/lib/env';
import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';

interface ProjectOverviewProps {
  projectId: string;
}

export function ProjectOverview({ projectId }: ProjectOverviewProps) {
  const { questionFiles, isLoading: isQL, error: err } = useQuestionsProvider();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(projectId);
  const { data: questions, isLoading: questionsLoading, error: questionsError } = useQuestions(projectId);
  const { currentOrganization } = useCurrentOrganization();
  const orgId = project?.orgId ?? currentOrganization?.id ?? '';

  // Fetch all outcomes across opportunities
  const { outcomes, isError: outcomesError, isLoading: outcomesLoading } = useProjectOutcomes(orgId || null, projectId);
  const getBriefByProject = useGetExecutiveBriefByProject();
  const { foiaRequests } = useFOIARequests(orgId, projectId);

  const [briefs, setBriefs] = useState<any[]>([]);

  // Fetch RFP documents count
  const rfpDocsUrl = orgId
    ? `${env.BASE_API_URL}/rfp-document/list?projectId=${projectId}&orgId=${orgId}`
    : null;
  const rfpDocsKey = orgId ? ['rfp-documents', projectId, orgId] : null;
  const { data: rfpDocsData } = useApi<{ items: any[]; count: number }>(rfpDocsKey, rfpDocsUrl);
  const rfpDocumentCount = rfpDocsData?.count ?? rfpDocsData?.items?.length ?? 0;

  // Fetch opportunities count
  const { items: opportunities } = useOpportunitiesList({
    orgId: orgId || null,
    projectId,
    limit: 100,
  });
  const opportunityCount = opportunities?.length ?? 0;

  // Fetch executive briefs for each opportunity
  useEffect(() => {
    if (!projectId || !opportunities?.length) return;

    const fetchBriefs = async () => {
      const results: any[] = [];
      for (const opp of opportunities) {
        try {
          const oppId = (opp as any).oppId ?? (opp as any).id;
          if (!oppId) continue;
          const resp = await getBriefByProject.trigger({ projectId, opportunityId: oppId });
          if (resp?.ok && resp?.brief) {
            results.push({ ...resp.brief, opportunityId: oppId, opportunityTitle: (opp as any).title });
          }
        } catch {
          // No brief for this opportunity — skip
        }
      }
      setBriefs(results);
    };

    fetchBriefs();
  }, [projectId, opportunities?.length]);

  // Early return after all hooks
  if (!isQL && !err && !questionFiles?.length) {
    return <NoRfpDocumentAvailable projectId={projectId} />;
  }

  const isLoading = questionsLoading || projectLoading;

  // Calculate project metrics
  const totalQuestions = questions?.sections?.reduce(
    (total: number, section: any) => total + (section.questions?.length ?? 0), 0,
  ) ?? 0;

  const answeredQuestions = questions?.sections?.reduce(
    (total: number, section: any) => total + (section.questions?.filter((q: any) => q.answer)?.length ?? 0), 0,
  ) ?? 0;

  const completionPercentage = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;

  // Brief statistics across all opportunities
  const briefStats = useMemo(() => {
    const sectionKeys = ['summary', 'deadlines', 'contacts', 'requirements', 'risks', 'pastPerformance'];
    let totalComplete = 0;
    let totalSections = 0;
    let fullyComplete = 0;

    for (const brief of briefs) {
      if (!brief?.sections) continue;
      const complete = sectionKeys.filter(k => brief.sections[k]?.status === 'COMPLETE').length;
      totalComplete += complete;
      totalSections += sectionKeys.length;
      if (complete === sectionKeys.length) fullyComplete++;
    }

    return {
      briefCount: briefs.length,
      fullyComplete,
      totalComplete,
      totalSections: totalSections || 6,
      avgPercent: totalSections > 0 ? Math.round((totalComplete / totalSections) * 100) : 0,
    };
  }, [briefs]);

  // RFP document type breakdown
  const rfpDocsByType = useMemo(() => {
    const items = rfpDocsData?.items ?? [];
    const counts: Record<string, number> = {};
    for (const doc of items) {
      const t = doc.documentType ?? 'OTHER';
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [rfpDocsData]);

  // Outcome statistics across all opportunities
  // Only calculate stats when we have valid data (not error and not loading)
  const outcomeStats = useMemo(() => {
    // If there's an error or we're loading, return empty stats
    if (outcomesError || outcomesLoading) {
      return { won: 0, lost: 0, pending: 0, noBid: 0, withdrawn: 0, total: 0, totalContractValue: 0, winRate: 0, hasError: outcomesError };
    }

    const stats = { won: 0, lost: 0, pending: 0, noBid: 0, withdrawn: 0, total: outcomes.length };
    let totalContractValue = 0;

    for (const o of outcomes) {
      switch (o.status) {
        case 'WON':
          stats.won++;
          if (o.winData?.contractValue) totalContractValue += o.winData.contractValue;
          break;
        case 'LOST': stats.lost++; break;
        case 'PENDING': stats.pending++; break;
        case 'NO_BID': stats.noBid++; break;
        case 'WITHDRAWN': stats.withdrawn++; break;
      }
    }

    const winRate = stats.won + stats.lost > 0
      ? Math.round((stats.won / (stats.won + stats.lost)) * 100)
      : 0;

    return { ...stats, totalContractValue, winRate, hasError: false };
  }, [outcomes, outcomesError, outcomesLoading]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-12">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-20" /></CardHeader>
              <CardContent><Skeleton className="h-10 w-16 mb-1" /><Skeleton className="h-3 w-32" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (projectError) {
    return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{projectError.message}</AlertDescription></Alert>;
  }

  if (!project) {
    return <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Project Not Found</AlertTitle><AlertDescription>The requested project could not be found.</AlertDescription></Alert>;
  }

  const createdAtFormatted = format(new Date(project.createdAt), 'MMM d, yyyy');
  const updatedAtRelative = formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true });
  const baseUrl = `/organizations/${project.orgId}/projects/${projectId}`;

  return (
    <div className="space-y-6 p-12">
      {/* Project Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold mb-2">{project.name}</h1>
          {project.description && <p className="text-muted-foreground">{project.description}</p>}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>Created {createdAtFormatted}</span>
          <span className="mx-1">•</span>
          <Clock className="h-4 w-4" />
          <span>Updated {updatedAtRelative}</span>
        </div>
      </div>

      {/* Primary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Opportunities */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/opportunities`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{opportunityCount}</div>
              <p className="text-xs text-muted-foreground">tracked opportunities</p>
              <div className="flex items-center justify-between mt-5">
                <Badge variant="outline" className="text-xs">{opportunityCount > 0 ? 'View All' : 'Search'}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Executive Briefs */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/brief`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Executive Briefs</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{briefStats.briefCount}</div>
              <p className="text-xs text-muted-foreground">
                {briefStats.briefCount === 1 ? 'brief' : 'briefs'} across opportunities
              </p>
              {briefStats.briefCount > 0 && (
                <Progress value={briefStats.avgPercent} className="h-1 mt-2" />
              )}
              <div className="flex items-center justify-between mt-3">
                {briefStats.briefCount > 0 ? (
                  <Badge variant={briefStats.fullyComplete === briefStats.briefCount ? 'default' : 'secondary'} className="text-xs">
                    {briefStats.fullyComplete}/{briefStats.briefCount} complete
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">None yet</Badge>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Questions */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/questions`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Questions</CardTitle>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{answeredQuestions}/{totalQuestions}</div>
              <p className="text-xs text-muted-foreground">questions answered</p>
              <Progress value={completionPercentage} className="h-1 mt-2" />
              <div className="flex items-center justify-between mt-3">
                <Badge variant={completionPercentage === 100 ? 'default' : 'secondary'} className="text-xs">
                  {completionPercentage}% complete
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* RFP Documents */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/opportunities`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">RFP Documents</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{rfpDocumentCount}</div>
              <p className="text-xs text-muted-foreground">across all opportunities</p>
              <div className="flex items-center justify-between mt-5">
                <div className="flex gap-1">
                  {Object.entries(rfpDocsByType).slice(0, 2).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {count} {type === 'TECHNICAL_PROPOSAL' ? 'Tech Proposals' : type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Outcomes — Win/Loss Statistics */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outcomes</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {outcomesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ) : outcomesError ? (
              <>
                <div className="text-2xl font-bold text-muted-foreground">—</div>
                <p className="text-xs text-muted-foreground">Unable to load outcomes</p>
                <div className="mt-3">
                  <Badge variant="outline" className="text-xs">Error loading data</Badge>
                </div>
              </>
            ) : outcomeStats.total > 0 ? (
              <div className="space-y-3">
                {/* Win rate */}
                <div>
                  <div className="text-2xl font-bold">{outcomeStats.winRate}%</div>
                  <p className="text-xs text-muted-foreground">win rate</p>
                </div>

                {/* Status breakdown */}
                <div className="flex flex-wrap gap-1.5">
                  {outcomeStats.won > 0 && (
                    <Badge variant="default" className="text-xs">
                      {outcomeStats.won} Won
                    </Badge>
                  )}
                  {outcomeStats.lost > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {outcomeStats.lost} Lost
                    </Badge>
                  )}
                  {outcomeStats.pending > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {outcomeStats.pending} Pending
                    </Badge>
                  )}
                  {outcomeStats.noBid > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {outcomeStats.noBid} No Bid
                    </Badge>
                  )}
                </div>

                {/* Total contract value */}
                {outcomeStats.totalContractValue > 0 && (
                  <p className="text-sm">
                    Total value: <span className="font-semibold">${outcomeStats.totalContractValue.toLocaleString()}</span>
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold">{opportunityCount}</div>
                <p className="text-xs text-muted-foreground">
                  {opportunityCount === 1 ? 'opportunity' : 'opportunities'} tracked
                </p>
                <div className="mt-3">
                  <Badge variant="outline" className="text-xs">No outcomes set yet</Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* FOIA Requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">FOIA Requests</CardTitle>
            <FileSearch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{foiaRequests?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {foiaRequests?.length ? 'competitive intelligence requests' : 'no requests yet'}
            </p>
            {foiaRequests && foiaRequests.length > 0 && (
              <div className="flex gap-1 mt-3">
                {['SUBMITTED', 'RECEIVED', 'PENDING'].map(status => {
                  const count = foiaRequests.filter((r: any) => r.status === status).length;
                  if (!count) return null;
                  return (
                    <Badge key={status} variant="outline" className="text-xs">
                      {count} {status.charAt(0) + status.slice(1).toLowerCase()}
                    </Badge>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Solicitation Documents */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{questionFiles?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">uploaded for extraction</p>
            <div className="flex items-center justify-between mt-5">
              <Badge variant="outline" className="text-xs">
                {questions?.sections?.length ?? 0} sections extracted
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/opportunities`}>
              <Briefcase className="h-4 w-4 mr-2" />
              View Opportunities
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/brief`}>
              <Target className="h-4 w-4 mr-2" />
              Executive Brief
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/questions`}>
              <HelpCircle className="h-4 w-4 mr-2" />
              Answer Questions
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/documents`}>
              <FileText className="h-4 w-4 mr-2" />
              Solicitation Documents
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}