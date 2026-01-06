'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Shield } from 'lucide-react';

export function RisksCard({ risks }: { risks: any }) {
  if (!risks) return null;

  return (
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
                  title="Severity of this risk."
                >
                  {r.severity}
                </Badge>

                <div className="flex-1 space-y-2">
                  <p className="font-semibold text-sm">{r.flag}</p>
                  {r.whyItMatters && <p className="text-sm text-muted-foreground leading-relaxed">{r.whyItMatters}</p>}
                  {r.mitigation && (
                    <div className="text-xs bg-muted p-2 rounded" title="Suggested mitigation / next step.">
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
                {risks.incumbentInfo.knownIncumbent ? risks.incumbentInfo.incumbentName || 'Known incumbent' : 'Not identified'}
              </span>
              {risks.incumbentInfo.recompete && (
                <Badge variant="outline" className="ml-2" title="This appears to be a recompete.">
                  Recompete
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
