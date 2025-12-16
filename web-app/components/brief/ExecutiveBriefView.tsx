'use client';

import React, { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useGenerateExecutiveBrief } from '@/lib/hooks/use-executive-brief';
import { useProject } from '@/lib/hooks/use-api';
import { Download, AlertTriangle, CheckCircle2, Clock, FileText } from 'lucide-react';

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

function recommendationVariant(rec?: string) {
  if (rec === 'GO') return 'default';
  if (rec === 'NO_GO') return 'destructive';
  return 'secondary';
}

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const variant = pct >= 80 ? 'default' : pct >= 60 ? 'secondary' : 'outline';
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-gray-600';

  return (
    <Badge variant={variant} className="gap-1">
      <span className={color}>●</span>
      {pct}% confidence
    </Badge>
  );
}

function DeadlineCard({ deadline }: { deadline: any }) {
  const isUrgent = deadline.datetime &&
    (new Date(deadline.datetime).getTime() - Date.now()) < 7 * 24 * 60 * 60 * 1000;

  const daysUntil = deadline.datetime
    ? Math.ceil((new Date(deadline.datetime).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className={`rounded border p-3 ${isUrgent ? 'border-destructive bg-destructive/5' : ''}`}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="font-medium flex items-center gap-2">
            {isUrgent && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {deadline.label}
          </div>
          {deadline.requiredAction && (
            <div className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium">Action:</span> {deadline.requiredAction}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">
            {deadline.datetime ? formatDate(deadline.datetime) : deadline.dateText || '—'}
          </div>
          {isUrgent && daysUntil !== null && (
            <div className="text-xs text-destructive mt-1 font-medium">
              {daysUntil > 0 ? (daysUntil === 1 ? '1 day' : `${daysUntil} days`) : 'Due today!'}
            </div>
          )}
          {deadline.timezone && (
            <div className="text-xs text-muted-foreground mt-1">
              {deadline.timezone}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function exportBriefAsText(brief: any, projectName: string) {
  const scoring = brief.scoring || {};
  const criteria = scoring.criteria || {};
  const composite = scoring.composite || {};
  const finalRec = brief.finalRecommendation || {};

  const text = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE OPPORTUNITY BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: ${projectName}
Generated: ${formatDate(brief.meta?.generatedAt)}
Model: ${brief.meta?.model || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDATION: ${finalRec.recommendation || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Score: ${composite.normalized || 0}/100
Confidence: ${Math.round((finalRec.confidence ?? 0) * 100)}%

${finalRec.topReasons?.length ? `
Top Reasons:
${finalRec.topReasons.map((r: string, i: number) => `  ${i + 1}. ${r}`).join('\n')}
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPPORTUNITY SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${brief.quickSummary ? `
Title: ${brief.quickSummary.title || 'N/A'}
Agency: ${brief.quickSummary.agency || 'N/A'}
NAICS: ${brief.quickSummary.naics || 'N/A'}
Contract Type: ${brief.quickSummary.contractType || 'N/A'}
Estimated Value: ${brief.quickSummary.estimatedValue || 'N/A'}
Set-Aside: ${brief.quickSummary.setAside || 'N/A'}
` : 'No summary available'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${Object.entries(criteria).map(([key, c]: any) => `
${key.replace(/([A-Z])/g, ' $1').toUpperCase()}
  Score: ${c.score}/5
  Confidence: ${Math.round((c.confidence ?? 0) * 100)}%
  Rationale: ${c.rationale || 'N/A'}
  Evidence: ${c.evidence?.length ? c.evidence.join('; ') : 'None provided'}
`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY DEADLINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${brief.deadlines?.items?.length ? brief.deadlines.items.map((d: any) => `
  ${d.label}: ${d.datetime ? formatDate(d.datetime) : d.dateText || 'N/A'}
  ${d.requiredAction ? `  Action: ${d.requiredAction}` : ''}
`).join('\n') : 'No deadlines extracted'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${finalRec.nextSteps?.length ? finalRec.nextSteps.map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') : 'No next steps provided'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `executive-brief-${projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExecutiveBriefView({ projectId }: { projectId: string }) {
  const { data: project, isLoading, isError, mutate: refetch } = useProject(projectId);
  const { trigger, isMutating } = useGenerateExecutiveBrief();

  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [previousBrief, setPreviousBrief] = useState<any>(null);

  async function regenerateBrief() {
    setRegenError(null);
    setGenerationProgress(null);

    if (!project) return;
    if (!project.orgId) {
      setRegenError('orgId is missing on project.');
      return;
    }

    // Save current brief before regenerating
    if (project.executiveBrief) {
      setPreviousBrief(project.executiveBrief);
    }

    try {
      setGenerationProgress('Generating brief...');
      await trigger({ projectId });
      await refetch();
      setGenerationProgress(null);
    } catch (e: any) {
      setRegenError(e?.message ?? 'Unknown error');
      setGenerationProgress(null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Executive Opportunity Brief</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 animate-spin" />
          Loading executive brief…
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
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Failed to load project</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const brief = project.executiveBrief;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 flex-1">
              <CardTitle className="text-xl flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Executive Opportunity Brief
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                Project: {project.name}
              </div>
              {brief?.meta?.generatedAt ? (
                <div className="text-xs text-muted-foreground">
                  Last generated: {formatDate(brief.meta.generatedAt)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Not generated yet
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {brief && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportBriefAsText(brief, project.name)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                )}
                <Button
                  onClick={regenerateBrief}
                  disabled={isMutating}
                  variant={brief ? 'outline' : 'default'}
                >
                  {isMutating
                    ? 'Generating…'
                    : brief
                      ? 'Regenerate Brief'
                      : 'Generate Brief'}
                </Button>
              </div>

              {generationProgress && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="h-3 w-3 animate-spin" />
                  {generationProgress}
                </div>
              )}

              {regenError && (
                <Alert variant="destructive" className="max-w-[360px]">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{regenError}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {!brief ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No executive brief generated yet. Click <b>Generate Brief</b> to analyze this opportunity.
          </CardContent>
        </Card>
      ) : (
        <>
          {previousBrief && brief && (
            <ChangesSummary previous={previousBrief} current={brief} />
          )}
          <BriefBody brief={brief} />
        </>
      )}
    </div>
  );
}

function ChangesSummary({ previous, current }: { previous: any; current: any }) {
  const prevScore = previous.scoring?.composite?.normalized || 0;
  const currScore = current.scoring?.composite?.normalized || 0;
  const prevRec = previous.finalRecommendation?.recommendation;
  const currRec = current.finalRecommendation?.recommendation;

  if (prevScore === currScore && prevRec === currRec) {
    return null;
  }

  return (
    <Alert>
      <CheckCircle2 className="h-4 w-4" />
      <AlertDescription>
        <div className="font-medium mb-1">Changes from Previous Brief</div>
        <div className="text-sm space-y-1">
          {prevScore !== currScore && (
            <div>
              Score: {prevScore} → {currScore} ({currScore > prevScore ? '+' : ''}{currScore - prevScore})
            </div>
          )}
          {prevRec !== currRec && (
            <div className="font-medium">
              Recommendation: {prevRec} → {currRec}
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function BriefBody({ brief }: { brief: any }) {
  const { quickSummary, scoring, deadlines, requirementsSummary, contacts, riskAssessment, submissionCompliance, finalRecommendation } =
    brief;

  return (
    <>
      {/* ===== DECISION ===== */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="text-xl">
                {quickSummary?.title || 'Untitled opportunity'}
              </CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                {quickSummary?.agency}
                {quickSummary?.naics && ` • NAICS ${quickSummary.naics}`}
                {quickSummary?.contractType && ` • ${quickSummary.contractType}`}
              </div>
              {quickSummary?.estimatedValue && (
                <div className="text-sm text-muted-foreground">
                  Est. Value: {quickSummary.estimatedValue}
                </div>
              )}
              {quickSummary?.setAside && (
                <Badge variant="outline" className="mt-2">
                  {quickSummary.setAside}
                </Badge>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <Badge variant={recommendationVariant(finalRecommendation?.recommendation)} className="text-base px-4 py-1">
                {finalRecommendation?.recommendation}
              </Badge>
              <Badge variant="outline">
                Score {scoring?.composite?.normalized}/100
              </Badge>
              <ConfidenceBadge confidence={finalRecommendation?.confidence} />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ===== 5-CRITERIA SCORE ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bid / No-Bid Scoring</CardTitle>
          <p className="text-sm text-muted-foreground">
            {scoring?.composite?.rationale || 'Five criteria scored from 1-5'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5 text-sm">
          {Object.entries(scoring?.criteria ?? {}).map(([key, c]: any) => (
            <Card key={key} className="border-dashed">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs uppercase tracking-wide">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={c.score >= 4 ? 'default' : c.score <= 2 ? 'destructive' : 'secondary'}>
                    {c.score}/5
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {Math.round((c.confidence ?? 0) * 100)}% conf
                  </span>
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {c.rationale}
                </div>
                {c.evidence?.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Evidence ({c.evidence.length})
                    </summary>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5 text-muted-foreground">
                      {c.evidence.map((e: string, i: number) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      {/* ===== DEADLINES ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Key Deadlines
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {deadlines?.items?.length ? (
            deadlines.items.map((d: any, idx: number) => (
              <DeadlineCard key={idx} deadline={d} />
            ))
          ) : (
            <div className="text-muted-foreground py-2">No deadlines extracted</div>
          )}
        </CardContent>
      </Card>

      {/* ===== REQUIREMENTS ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requirements Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="font-medium">Scope Overview</div>
            <div className="text-muted-foreground">
              {requirementsSummary?.scopeOverview || '—'}
            </div>
          </div>

          <Separator />

          {[
            ['Key Deliverables', requirementsSummary?.keyDeliverables],
            ['Mandatory Requirements', requirementsSummary?.mandatoryRequirements],
            ['Evaluation Criteria', requirementsSummary?.evaluationCriteria],
          ].map(([label, items]: any) => (
            <div key={label}>
              <div className="font-medium">{label}</div>
              {items?.length ? (
                <ul className="list-disc pl-5 text-muted-foreground space-y-0.5 mt-1">
                  {items.map((x: string, i: number) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ===== CONTACTS ===== */}
      {contacts?.items?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Directory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {contacts.items.map((contact: any, idx: number) => (
              <div key={idx} className="rounded border p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{contact.name || 'N/A'}</div>
                    <Badge variant="outline" className="text-xs mt-1">
                      {contact.role || 'Contact'}
                    </Badge>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {contact.email && <div>{contact.email}</div>}
                    {contact.phone && <div>{contact.phone}</div>}
                  </div>
                </div>
                {contact.notes && (
                  <div className="text-xs text-muted-foreground mt-2">
                    {contact.notes}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ===== RISKS ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Risks & Red Flags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {riskAssessment?.redFlags?.length ? (
            riskAssessment.redFlags.map((r: any, idx: number) => (
              <div key={idx} className="rounded border p-3">
                <div className="flex gap-2 items-start">
                  <Badge
                    variant={
                      r.severity === 'HIGH'
                        ? 'destructive'
                        : r.severity === 'MEDIUM'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {r.severity}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium">{r.flag}</div>
                    <div className="text-muted-foreground mt-1">{r.explanation}</div>
                    {r.mitigation && (
                      <div className="text-xs text-muted-foreground mt-2">
                        <span className="font-medium">Mitigation:</span> {r.mitigation}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground py-2">No major risks identified</div>
          )}

          {riskAssessment?.unknowns?.length > 0 && (
            <div className="mt-3">
              <div className="font-medium mb-2">Critical Unknowns</div>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                {riskAssessment.unknowns.map((u: string, i: number) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== SUBMISSION COMPLIANCE ===== */}
      {submissionCompliance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {submissionCompliance.volumes?.length > 0 && (
              <div>
                <div className="font-medium">Volumes</div>
                <div className="space-y-2 mt-2">
                  {submissionCompliance.volumes.map((v: any, i: number) => (
                    <div key={i} className="rounded border p-2">
                      <div className="font-medium text-xs">{v.name}</div>
                      {v.pageLimit && (
                        <div className="text-xs text-muted-foreground">
                          Page Limit: {v.pageLimit}
                        </div>
                      )}
                      {v.requirements && (
                        <div className="text-xs text-muted-foreground">
                          {v.requirements}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {submissionCompliance.formatsAndFonts && (
              <div>
                <div className="font-medium">Format Requirements</div>
                <div className="text-muted-foreground">
                  {submissionCompliance.formatsAndFonts}
                </div>
              </div>
            )}

            {submissionCompliance.requiredForms?.length > 0 && (
              <div>
                <div className="font-medium">Required Forms</div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {submissionCompliance.requiredForms.map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {submissionCompliance.deliveryMethod && (
              <div>
                <div className="font-medium">Delivery Method</div>
                <div className="text-muted-foreground">
                  {submissionCompliance.deliveryMethod}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== FINAL RECOMMENDATION ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final Recommendation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={recommendationVariant(finalRecommendation?.recommendation)} className="text-base px-4 py-1">
              {finalRecommendation?.recommendation}
            </Badge>
            <ConfidenceBadge confidence={finalRecommendation?.confidence} />
          </div>

          {finalRecommendation?.topReasons?.length > 0 && (
            <div>
              <div className="font-medium mb-1">Key Reasons</div>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                {finalRecommendation.topReasons.map((r: string, i: number) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {finalRecommendation?.nextSteps?.length > 0 && (
            <div>
              <div className="font-medium mb-1">Next Steps</div>
              <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
                {finalRecommendation.nextSteps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}