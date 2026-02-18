'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Shield } from 'lucide-react';

export function RisksCard({ risks }: { risks: any }) {
  if (!risks) return null;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5"/>
          <CardTitle>Risk Analysis</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {risks?.redFlags?.length ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identified Risks</p>
            {risks.redFlags.map((r: any, idx: number) => (
              <div key={idx} className="border-l-4 pl-4 py-2 space-y-2">
                <div className="flex items-start gap-2">
                  <Badge
                    variant={
                      r.severity === 'CRITICAL' || r.severity === 'HIGH'
                        ? 'destructive'
                        : r.severity === 'MEDIUM'
                          ? 'secondary'
                          : 'outline'
                    }
                    className="text-xs"
                    title="Severity of this risk."
                  >
                    {r.severity}
                  </Badge>
                  <p className="font-semibold text-sm">{r.flag}</p>
                </div>
                
                {r.whyItMatters && (
                  <p className="text-sm text-muted-foreground leading-relaxed ml-0">{r.whyItMatters}</p>
                )}
                
                {r.mitigation && (
                  <div className="border rounded p-2 bg-muted/30 text-xs">
                    <span className="font-medium">Mitigation:</span> <span className="text-muted-foreground">{r.mitigation}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="border rounded-lg p-6 text-center">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2"/>
            <p className="text-sm text-muted-foreground">No major red flags identified</p>
          </div>
        )}

        {risks?.incumbentInfo && (
          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Incumbent Information</p>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Current Incumbent:</span>{' '}
                <span className="text-muted-foreground">
                  {risks.incumbentInfo.knownIncumbent ? risks.incumbentInfo.incumbentName || 'Known incumbent' : 'Not identified'}
                </span>
              </div>
              {risks.incumbentInfo.recompete && (
                <div>
                  <Badge variant="outline" title="This appears to be a recompete.">
                    Recompete Opportunity
                  </Badge>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
