'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react';

export function ScoringGrid({ scoring }: { scoring: any }) {
  if (!scoring) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          <CardTitle className="text-lg">Bid / No-Bid Scoring</CardTitle>
        </div>

        {scoring?.summaryJustification && (
          <p className="text-sm text-muted-foreground mt-2">{scoring.summaryJustification}</p>
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
                  title="Score (1–5) for this criterion."
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
  );
}