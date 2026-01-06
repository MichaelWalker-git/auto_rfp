'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileText } from 'lucide-react';

export function RequirementsCard({ requirements }: { requirements: any }) {
  if (!requirements) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
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

        <Separator />

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
                    {r.mustHave && (
                      <Badge variant="destructive" className="ml-2 text-xs" title="Marked as must-have.">
                        MUST HAVE
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

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
  );
}