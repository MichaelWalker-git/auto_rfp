'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

export function ExecutiveCloseOutCard({ scoring }: { scoring: any }) {
  if (!scoring) return null;

  const blockers = scoring?.blockers ?? [];
  const requiredActions = scoring?.requiredActions ?? [];
  const confidenceDrivers = scoring?.confidenceDrivers ?? [];

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5"/>
          <CardTitle>Executive Summary & Next Steps</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {scoring?.decisionRationale && (
          <div className="border-l-4 pl-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Decision Rationale</p>
            <p className="text-sm leading-relaxed">{scoring.decisionRationale}</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Critical Blockers</p>
            {blockers.length ? (
              <ul className="space-y-2">
                {blockers.map((b: string, i: number) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="font-bold text-muted-foreground flex-shrink-0">{i + 1}.</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground italic">No blockers identified</div>
            )}
          </div>

          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Required Actions</p>
            {requiredActions.length ? (
              <ol className="space-y-2">
                {requiredActions.map((a: string, i: number) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="font-bold text-muted-foreground flex-shrink-0">{i + 1}.</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-sm text-muted-foreground italic">No required actions identified</div>
            )}
          </div>
        </div>

        {scoring?.confidenceExplanation && (
          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Confidence Assessment</p>
            <p className="text-sm leading-relaxed">{scoring.confidenceExplanation}</p>
          </div>
        )}

        {confidenceDrivers.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Key Drivers</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {confidenceDrivers.map((d: any, i: number) => (
                <div key={i} className="border rounded p-2 text-xs flex items-start gap-2">
                  {d.direction === 'UP' ? (
                    <Badge variant="default" className="text-xs px-2 py-0.5 flex-shrink-0">+</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 flex-shrink-0">−</Badge>
                  )}
                  <span className="text-muted-foreground">{d.factor}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
