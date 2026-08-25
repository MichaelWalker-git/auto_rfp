'use client';

import Link from 'next/link';
import { ExternalLink, Sparkles, Trash2, ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { RelatedRfpListItem } from '@auto-rfp/core';

import { formatRelatedDate, formatMatchScore } from '../lib/format';
import { safeExternalUrl } from '@/lib/safe-url';

interface RelatedRfpRowProps {
  item: RelatedRfpListItem;
  /** Path to an already-imported opportunity (built by the parent when linked). */
  linkedHref?: string | null;
  /** Whether the current user may remove this specific link. */
  canRemove: boolean;
  isRemoving?: boolean;
  onRemove: (relatedOppKey: string) => void;
}

/**
 * One related-RFP link. Deep-links to the in-app opportunity when it is already
 * imported (linkedOpportunityId), otherwise links out to HigherGov (sourceUrl).
 */
export const RelatedRfpRow = ({
  item,
  linkedHref,
  canRemove,
  isRemoving = false,
  onRemove,
}: RelatedRfpRowProps) => {
  const scoreLabel = item.origin === 'AUTO' ? formatMatchScore(item.matchScore) : null;

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          {item.origin === 'AUTO' ? (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Auto
            </Badge>
          ) : (
            <Badge variant="outline">Added</Badge>
          )}
          {scoreLabel && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {scoreLabel}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {item.organizationName && <span className="truncate">{item.organizationName}</span>}
          <span>Posted {formatRelatedDate(item.postedDateIso)}</span>
          <span>Due {formatRelatedDate(item.dueDateIso)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {linkedHref ? (
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <Link href={linkedHref}>
              View
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : safeExternalUrl(item.sourceUrl) ? (
          /**
           * Scheme-checked even though it comes from HigherGov rather than a user.
           *
           * `sourceUrl` is `z.string().nullish()` on the schema — no validation at all —
           * and it is stored verbatim from an upstream API response. Trusting a third
           * party's field to be http(s) is the same bet as trusting user input, and a
           * `href` executes whatever scheme it is given.
           */
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <a
              href={safeExternalUrl(item.sourceUrl) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              HigherGov
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}

        {canRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                disabled={isRemoving}
                onClick={() => onRemove(item.relatedOppKey)}
                aria-label="Remove related RFP"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {item.origin === 'AUTO' ? 'Remove (admin — won’t reappear)' : 'Remove'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
