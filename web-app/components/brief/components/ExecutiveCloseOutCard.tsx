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
              <Badge key={i} variant="outline" className="text-xs" title="Factor moving confidence up/down.">
                {d.direction === 'UP' ? 'UP' : 'DOWN'}: {d.factor}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}