'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileText } from 'lucide-react';
import { RFP_DOCUMENT_TYPES } from '@auto-rfp/core';

export function RequirementsCard({ requirements }: { requirements: any }) {
  if (!requirements) return null;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <CardTitle>Requirements Summary</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {requirements?.overview && (
          <div className="border-l-4 pl-4 py-2">
            <p className="text-sm leading-relaxed">{requirements.overview}</p>
          </div>
        )}

        {requirements?.requirements?.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Requirements ({requirements.requirements.length})</p>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {requirements.requirements.slice(0, 20).map((r: any, i: number) => (
                <div key={i} className="border rounded p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{r.category}</span>
                    {r.mustHave && (
                      <Badge variant="destructive" className="text-xs px-2 py-0.5 flex-shrink-0">
                        MUST HAVE
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{r.requirement}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Deliverables</p>
            {requirements?.deliverables?.length ? (
              <ul className="space-y-2 text-sm">
                {requirements.deliverables.slice(0, 8).map((x: string, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground flex-shrink-0">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">—</p>
            )}
          </div>

          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Evaluation Factors</p>
            {requirements?.evaluationFactors?.length ? (
              <ul className="space-y-2 text-sm">
                {requirements.evaluationFactors.slice(0, 8).map((x: string, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground flex-shrink-0">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">—</p>
            )}
          </div>

          <div className="border rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Submission Requirements</p>
            {requirements?.submissionCompliance?.format?.length ? (
              <ul className="space-y-2 text-sm">
                {requirements.submissionCompliance.format.slice(0, 8).map((x: string, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground flex-shrink-0">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">—</p>
            )}
          </div>
        </div>

        {/* Required output documents */}
        {requirements?.submissionCompliance?.requiredDocuments?.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Required Response Documents ({requirements.submissionCompliance.requiredDocuments.length})
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {requirements.submissionCompliance.requiredDocuments.map((doc: any, i: number) => {
                const label = RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType;
                return (
                  <div key={i} className="border rounded-lg p-3 flex items-start gap-2">
                    <FileText className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{doc.name}</span>
                        {doc.required && (
                          <Badge variant="destructive" className="text-xs h-4 px-1">Required</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      {doc.pageLimit && (
                        <p className="text-xs text-muted-foreground">Limit: {doc.pageLimit}</p>
                      )}
                      {doc.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{doc.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
