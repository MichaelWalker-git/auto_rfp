'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
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
} from '@/lib/hooks/use-executive-brief';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  RefreshCw,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Users
} from 'lucide-react';
import { exportBriefAsDocx } from '@/components/brief/helpers';

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

function recommendationVariant(rec?: string) {
  if (rec === 'GO') return 'default';
  if (rec === 'NO_GO') return 'destructive';
  if (rec === 'CONDITIONAL_GO') return 'secondary';
  return 'secondary';
}

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  const pct = Math.round(confidence ?? 0);
  const variant = pct >= 80 ? 'default' : pct >= 60 ? 'secondary' : 'outline';
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-gray-600';

  return (
    <Badge variant={variant} className="gap-1">
      <span className={color}>●</span>
      {pct}% confidence
    </Badge>
  );
}

function ScoreChangeIndicator({ prev, current }: { prev?: number; current?: number }) {
  if (prev === undefined || current === undefined || prev === current) return null;

  const diff = current - prev;
  const isPositive = diff > 0;

  return (
    <span className={`text-xs flex items-center gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
      {isPositive ? '+' : ''}{diff.toFixed(1)}
    </span>
  );
}

export type Props = {
  projectId: string;
  orgId: string;
  questionFileId: string;
};

export function ExecutiveBriefView({ projectId }: Props) {
  const { data: project, isLoading, isError, mutate: refetchProject } = useProject(projectId);

  const init = useInitExecutiveBrief();
  const genSummary = useGenerateExecutiveBriefSummary();
  const genDeadlines = useGenerateExecutiveBriefDeadlines();
  const genContacts = useGenerateExecutiveBriefContacts();
  const genRequirements = useGenerateExecutiveBriefRequirements();
  const genRisks = useGenerateExecutiveBriefRisks();
  const genScoring = useGenerateExecutiveBriefScoring();

  const getBriefByProject = useGetExecutiveBriefByProject();

  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [previousBrief, setPreviousBrief] = useState<any>(null);

  const [briefItem, setBriefItem] = useState<any>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const anyMutating =
    init.isMutating ||
    genSummary.isMutating ||
    genDeadlines.isMutating ||
    genContacts.isMutating ||
    genRequirements.isMutating ||
    genRisks.isMutating ||
    genScoring.isMutating ||
    getBriefByProject.isMutating;

  const allSections = briefItem?.sections;
  const sectionsState = useMemo(() => {
    if (!allSections) return null;
    return {
      summary: allSections.summary?.status,
      deadlines: allSections.deadlines?.status,
      contacts: allSections.contacts?.status,
      requirements: allSections.requirements?.status,
      risks: allSections.risks?.status,
      scoring: allSections.scoring?.status,
    };
  }, [allSections]);

  const completedSections = useMemo(() => {
    if (!sectionsState) return 0;
    return Object.values(sectionsState).filter(s => s === 'COMPLETE').length;
  }, [sectionsState]);

  const totalSections = 6;

  function startPollingBrief() {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const resp = await getBriefByProject.trigger({ projectId });
        if (resp?.ok && resp?.brief) {
          setBriefItem(resp.brief);

          const st = resp.brief.status;
          if (st === 'COMPLETE' || st === 'FAILED') {
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
    if (sectionsState) {
      const completed = Object.values(sectionsState).filter(s => s === 'COMPLETE').length;
      setProgressPercent((completed / totalSections) * 100);
    }
  }, [sectionsState]);

  async function ensureBriefId(): Promise<string> {
    if (project?.executiveBriefId) return project.executiveBriefId;

    setGenerationProgress('Initializing executive brief…');
    setProgressPercent(5);
    const resp = await init.trigger({ projectId });

    await refetchProject();

    if (!resp?.ok || !resp.executiveBriefId) {
      throw new Error(resp?.error || 'Failed to initialize executive brief');
    }

    return resp.executiveBriefId;
  }

  async function generateAllSections(executiveBriefId: string, force: boolean) {
    setGenerationProgress('Generating sections…');
    setProgressPercent(20);

    await Promise.all([
      genSummary.trigger({ executiveBriefId, force }),
      genDeadlines.trigger({ executiveBriefId, force }),
      genContacts.trigger({ executiveBriefId, force }),
      genRequirements.trigger({ executiveBriefId, force, topK: 20 }),
      genRisks.trigger({ executiveBriefId, force }),
    ]);

    setProgressPercent(80);
    setGenerationProgress('Scoring bid/no-bid…');
    await genScoring.trigger({ executiveBriefId, force, topK: 30 });
    setProgressPercent(100);
  }

  async function generateBrief({ force, newBrief }: { force: boolean; newBrief: boolean }) {
    setRegenError(null);
    setGenerationProgress(null);
    setProgressPercent(0);

    if (!project) return;

    if (briefItem) setPreviousBrief(briefItem);

    try {
      let executiveBriefId: string;

      if (newBrief) {
        setGenerationProgress('Creating a new executive brief…');
        setProgressPercent(5);
        const resp = await init.trigger({ projectId });
        await refetchProject();

        if (!resp?.ok || !resp.executiveBriefId) {
          throw new Error(resp?.error || 'Failed to initialize executive brief');
        }
        executiveBriefId = resp.executiveBriefId;
      } else {
        executiveBriefId = await ensureBriefId();
      }

      startPollingBrief();

      await generateAllSections(executiveBriefId, force);

      const latest = await getBriefByProject.trigger({ projectId });
      if (latest?.ok && latest?.brief) setBriefItem(latest.brief);

      setGenerationProgress(null);
      setProgressPercent(0);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
      setGenerationProgress(null);
      setProgressPercent(0);
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
  const deadlines = briefItem?.sections?.deadlines?.data;
  const requirements = briefItem?.sections?.requirements?.data;
  const contacts = briefItem?.sections?.contacts?.data;
  const risks = briefItem?.sections?.risks?.data;

  const recommendation = briefItem?.recommendation ?? scoring?.recommendation;
  const decision = briefItem?.decision ?? scoring?.decision;
  const decisionBadge = decision ?? recommendation;
  const confidence = briefItem?.confidence ?? scoring?.confidence;
  const compositeScore = briefItem?.compositeScore ?? scoring?.compositeScore;
  const blockers = scoring?.blockers ?? [];
  const requiredActions = scoring?.requiredActions ?? [];
  const confidenceDrivers = scoring?.confidenceDrivers ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-2">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <CardTitle className="text-2xl flex items-center gap-3">
                <FileText className="h-6 w-6"/>
                Executive Opportunity Brief
              </CardTitle>

              <div className="text-base font-medium text-foreground">{project.name}</div>

              <div className="text-sm text-muted-foreground">
                {briefItem?.updatedAt ? `Last updated: ${formatDate(briefItem.updatedAt)}` : 'Not generated yet'}
              </div>

              {sectionsState && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {Object.entries(sectionsState).map(([k, v]) => (
                    <Badge
                      key={k}
                      variant={v === 'COMPLETE' ? 'default' : v === 'FAILED' ? 'destructive' : 'outline'}
                      className="capitalize"
                    >
                      {k.replace(/_/g, ' ')}: {v ?? '—'}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className="flex gap-2 flex-wrap justify-end">
                {briefItem && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportBriefAsDocx(project.name, briefItem)}
                    disabled={anyMutating}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4"/>
                    Export DOCX
                  </Button>
                )}

                <Button
                  onClick={() => generateBrief({ force: false, newBrief: false })}
                  disabled={anyMutating}
                  variant={briefItem ? 'outline' : 'default'}
                  size="sm"
                >
                  {anyMutating ? 'Working…' : briefItem ? 'Generate Missing' : 'Generate Brief'}
                </Button>

                <Button
                  onClick={() => generateBrief({ force: true, newBrief: false })}
                  disabled={anyMutating || !briefItem}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4"/>
                  Regenerate
                </Button>
              </div>

              {generationProgress && (
                <div className="w-full space-y-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Clock className="h-3 w-3 animate-spin"/>
                    {generationProgress}
                  </div>
                  <Progress value={progressPercent} className="h-2"/>
                </div>
              )}

              {regenError && (
                <Alert variant="destructive" className="max-w-[520px]">
                  <AlertTriangle className="h-4 w-4"/>
                  <AlertDescription className="text-xs">{regenError}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {!briefItem ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4"/>
            <p className="text-sm text-muted-foreground">
              No executive brief yet. Click <span className="font-semibold">Generate Brief</span> to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {previousBrief && (
            <ChangesSummary previous={previousBrief} current={briefItem}/>
          )}

          {/* Decision Card */}
          <Card className="border-2">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap justify-between gap-6">
                <div className="flex-1 space-y-3">
                  <CardTitle className="text-2xl">{summary?.title || 'Untitled opportunity'}</CardTitle>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    {summary?.agency && <span>{summary.agency}</span>}
                    {summary?.naics && <span>• NAICS {summary.naics}</span>}
                    {summary?.contractType && <span>• {summary.contractType}</span>}
                  </div>

                  {typeof summary?.estimatedValueUsd === 'number' && (
                    <div className="text-lg font-semibold text-foreground">
                      ${summary.estimatedValueUsd.toLocaleString()} USD
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    {summary?.setAside && summary.setAside !== 'UNKNOWN' && (
                      <Badge variant="outline">{summary.setAside}</Badge>
                    )}
                    {summary?.placeOfPerformance && (
                      <Badge variant="outline">{summary.placeOfPerformance}</Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">Decision</div>
                  <Badge
                    variant={recommendationVariant(decisionBadge)}
                    className="text-lg px-6 py-2"
                  >
                    {decisionBadge || '—'}
                  </Badge>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-base px-4 py-1">
                      {typeof compositeScore === 'number' ? compositeScore.toFixed(1) : '—'}/5
                    </Badge>
                    <ScoreChangeIndicator
                      prev={previousBrief?.compositeScore}
                      current={compositeScore}
                    />
                  </div>

                  <ConfidenceBadge confidence={confidence}/>
                </div>
              </div>

              {summary?.summary && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {summary.summary}
                  </p>
                </div>
              )}
            </CardHeader>
          </Card>

          {scoring && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5"/>
                  <CardTitle className="text-lg">Executive Close-Out</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Blockers</div>
                    {blockers.length ? (
                      <ul className="space-y-1">
                        {blockers.map((b: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex gap-2">
                            <span>•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-sm text-muted-foreground">No blockers identified</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Required Actions to Proceed</div>
                    {requiredActions.length ? (
                      <ul className="space-y-1">
                        {requiredActions.map((a: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex gap-2">
                            <span>•</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-sm text-muted-foreground">No required actions identified</div>
                    )}
                  </div>
                </div>

                {scoring?.decisionRationale && (
                  <div>
                    <div className="text-sm font-semibold">Decision Rationale</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{scoring.decisionRationale}</p>
                  </div>
                )}

                {scoring?.confidenceExplanation && (
                  <div>
                    <div className="text-sm font-semibold">Confidence Summary</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{scoring.confidenceExplanation}</p>
                  </div>
                )}

                {confidenceDrivers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {confidenceDrivers.map((d: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {d.direction === 'UP' ? 'UP' : 'DOWN'}: {d.factor}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Scoring Grid */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5"/>
                <CardTitle className="text-lg">Bid / No-Bid Scoring</CardTitle>
              </div>
              {scoring?.summaryJustification && (
                <p className="text-sm text-muted-foreground mt-2">
                  {scoring.summaryJustification}
                </p>
              )}
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-5">
              {(scoring?.criteria ?? []).map((c: any) => (
                <Card key={c.name} className="border-2 hover:shadow-lg transition-shadow">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-xs uppercase tracking-wide font-semibold">
                      {String(c.name).replace(/_/g, ' ')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 pb-4">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={c.score >= 4 ? 'default' : c.score <= 2 ? 'destructive' : 'secondary'}
                        className="text-lg px-3 py-1"
                      >
                        {c.score}/5
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">{c.rationale}</p>

                    {c.gaps?.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                          Gaps ({c.gaps.length})
                        </summary>
                        <ul className="list-disc pl-4 mt-2 space-y-1 text-muted-foreground">
                          {c.gaps.map((g: string, i: number) => (
                            <li key={i}>{g}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>

          {/* Deadlines */}
          <DeadlinesDashboard
            projectId={projectId}
            orgId={project.orgId}
            key={briefItem?.updatedAt || 'no-brief'}
          />

          {/* Requirements */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5"/>
                <CardTitle className="text-lg">Requirements</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {requirements?.overview && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Overview</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{requirements.overview}</p>
                </div>
              )}

              <Separator/>

              {requirements?.requirements?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Key Requirements</h4>
                  <div className="space-y-2">
                    {requirements.requirements.slice(0, 30).map((r: any, i: number) => (
                      <div key={i} className="text-sm flex gap-2">
                        <span className="text-muted-foreground">•</span>
                        <span>
                          <span className="font-medium">{r.category}:</span>{' '}
                          <span className="text-muted-foreground">{r.requirement}</span>
                          {r.mustHave && <Badge variant="destructive" className="ml-2 text-xs">MUST HAVE</Badge>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator/>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <h4 className="font-semibold text-sm mb-2">Deliverables</h4>
                  {requirements?.deliverables?.length ? (
                    <ul className="space-y-1">
                      {requirements.deliverables.map((x: string, i: number) => (
                        <li key={i} className="text-sm text-muted-foreground flex gap-2">
                          <span>•</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">Evaluation Factors</h4>
                  {requirements?.evaluationFactors?.length ? (
                    <ul className="space-y-1">
                      {requirements.evaluationFactors.map((x: string, i: number) => (
                        <li key={i} className="text-sm text-muted-foreground flex gap-2">
                          <span>•</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">Submission Compliance</h4>
                  {requirements?.submissionCompliance?.format?.length ? (
                    <ul className="space-y-1">
                      {requirements.submissionCompliance.format.map((x: string, i: number) => (
                        <li key={i} className="text-sm text-muted-foreground flex gap-2">
                          <span>•</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contacts */}
          {contacts?.contacts?.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5"/>
                  <CardTitle className="text-lg">Contact Directory</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {contacts.contacts.map((c: any, idx: number) => (
                  <div key={idx} className="rounded-lg border p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="font-semibold text-sm">{c.name || 'N/A'}</div>
                        <Badge variant="outline" className="text-xs mt-2">
                          {c.role || 'OTHER'}
                        </Badge>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        {c.email && <div>{c.email}</div>}
                        {c.phone && <div>{c.phone}</div>}
                      </div>
                    </div>
                    {c.notes && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{c.notes}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Risks */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5"/>
                <CardTitle className="text-lg">Risks & Red Flags</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {risks?.redFlags?.length ? (
                risks.redFlags.map((r: any, idx: number) => (
                  <div key={idx} className="rounded-lg border p-4 hover:shadow-md transition-shadow">
                    <div className="flex gap-3 items-start">
                      <Badge
                        variant={
                          r.severity === 'CRITICAL' || r.severity === 'HIGH'
                            ? 'destructive'
                            : r.severity === 'MEDIUM'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="shrink-0"
                      >
                        {r.severity}
                      </Badge>
                      <div className="flex-1 space-y-2">
                        <p className="font-semibold text-sm">{r.flag}</p>
                        {r.whyItMatters && (
                          <p className="text-sm text-muted-foreground leading-relaxed">{r.whyItMatters}</p>
                        )}
                        {r.mitigation && (
                          <div className="text-xs bg-muted p-2 rounded">
                            <span className="font-medium">Mitigation:</span> {r.mitigation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground py-4 text-center text-sm flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600"/>
                  No major red flags identified
                </div>
              )}

              {risks?.incumbentInfo && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <div className="text-sm">
                    <span className="font-semibold">Incumbent:</span>{' '}
                    <span className="text-muted-foreground">
                      {risks.incumbentInfo.knownIncumbent
                        ? (risks.incumbentInfo.incumbentName || 'Known incumbent')
                        : 'Not identified'}
                    </span>
                    {risks.incumbentInfo.recompete && (
                      <Badge variant="outline" className="ml-2">Recompete</Badge>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ChangesSummary({ previous, current }: { previous: any; current: any }) {
  const prevScore = previous?.compositeScore ?? previous?.sections?.scoring?.data?.compositeScore;
  const currScore = current?.compositeScore ?? current?.sections?.scoring?.data?.compositeScore;

  const prevRec = previous?.recommendation ?? previous?.sections?.scoring?.data?.recommendation;
  const currRec = current?.recommendation ?? current?.sections?.scoring?.data?.recommendation;
  const prevDecision = previous?.decision ?? previous?.sections?.scoring?.data?.decision;
  const currDecision = current?.decision ?? current?.sections?.scoring?.data?.decision;

  if (prevScore === currScore && prevRec === currRec && prevDecision === currDecision) return null;

  const scoreChange = currScore && prevScore ? currScore - prevScore : null;

  return (
    <Alert className="border-2">
      <CheckCircle2 className="h-5 w-5"/>
      <AlertDescription>
        <div className="font-semibold text-base mb-2">Changes from Previous Brief</div>
        <div className="space-y-2">
          {prevScore !== currScore && (
            <div className="flex items-center gap-2">
              <span className="text-sm">Score:</span>
              <Badge variant="outline">{prevScore ?? '—'}</Badge>
              <span>→</span>
              <Badge variant="outline">{currScore ?? '—'}</Badge>
              {scoreChange !== null && (
                <span className={`text-sm font-medium ${scoreChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {scoreChange > 0 ? '+' : ''}{scoreChange.toFixed(1)}
                </span>
              )}
            </div>
          )}
          {prevRec !== currRec && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Recommendation:</span>
              <Badge variant={recommendationVariant(prevRec)}>{prevRec ?? '—'}</Badge>
              <span>→</span>
              <Badge variant={recommendationVariant(currRec)}>{currRec ?? '—'}</Badge>
            </div>
          )}
          {prevDecision !== currDecision && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Decision:</span>
              <Badge variant={recommendationVariant(prevDecision)}>{prevDecision ?? '—'}</Badge>
              <span>→</span>
              <Badge variant={recommendationVariant(currDecision)}>{currDecision ?? '—'}</Badge>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
