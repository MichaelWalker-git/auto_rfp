'use client';

import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';
import { recommendationVariant } from '../helpers';

export function ChangesSummary({ previous, current }: { previous: any; current: any }) {
  const prevScore = previous?.compositeScore ?? previous?.sections?.scoring?.data?.compositeScore;
  const currScore = current?.compositeScore ?? current?.sections?.scoring?.data?.compositeScore;

  const prevRec = previous?.recommendation ?? previous?.sections?.scoring?.data?.recommendation;
  const currRec = current?.recommendation ?? current?.sections?.scoring?.data?.recommendation;

  const prevDecision = previous?.decision ?? previous?.sections?.scoring?.data?.decision;
  const currDecision = current?.decision ?? current?.sections?.scoring?.data?.decision;

  if (prevScore === currScore && prevRec === currRec && prevDecision === currDecision) return null;

  const scoreChange = currScore != null && prevScore != null ? currScore - prevScore : null;

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
                  {scoreChange > 0 ? '+' : ''}
                  {scoreChange.toFixed(1)}
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
