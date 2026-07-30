'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import type { RfpPipelineItem } from '@auto-rfp/core';
import { deriveFlags, groupFlagsByType, FLAG_LABELS, type FlagType } from '../lib/derive-flags';

interface NeedsAttentionPanelProps {
  items: RfpPipelineItem[];
  /**
   * @deprecated Rows now link to the source Linear issue via `sourceUrl`.
   * Retained for call-site compatibility.
   */
  orgId?: string;
}

const FLAG_ORDER: FlagType[] = [
  'SUBMITTED_WITHOUT_APPROVAL',
  'MISSING_OWNER',
  'MISSING_DEADLINE',
  'TERMINAL_MISSING_OUTCOME',
];

/**
 * Grouped list of data-integrity flags. Each row links to the source Linear
 * issue (opened in a new tab) so the owner can fix the underlying record.
 */
export function NeedsAttentionPanel({ items }: NeedsAttentionPanelProps) {
  const grouped = useMemo(() => groupFlagsByType(deriveFlags(items)), [items]);
  const totalFlags = FLAG_ORDER.reduce((sum, type) => sum + grouped[type].length, 0);

  if (totalFlags === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
        Nothing needs attention — every opportunity looks healthy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {FLAG_ORDER.filter((type) => grouped[type].length > 0).map((type) => (
        <Card key={type}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {FLAG_LABELS[type]}
              <Badge variant="outline" className="ml-1 text-xs text-slate-500">
                {grouped[type].length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {grouped[type].map((flag) => {
              const sourceUrl = flag.item.sourceUrl?.trim();

              return (
                <div key={`${type}-${flag.item.id}`} className="text-sm text-slate-600">
                  {sourceUrl ? (
                    <Link
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-words text-indigo-600 hover:underline"
                    >
                      {flag.message}
                    </Link>
                  ) : (
                    <span className="break-words">{flag.message}</span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
