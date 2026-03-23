'use client';

import React, { useState, useRef, useEffect } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, FolderOpen, Tag, UserCircle2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OpportunityStageBadge } from '../opportunity-stage-badge';
import { formatDateTime } from '../opportunity-helpers';
import type { OpportunityItem, OpportunityStage } from '@auto-rfp/core';

interface OpportunityHeaderViewProps {
  opportunity: OpportunityItem;
  orgId: string | undefined;
  projectId: string | null;
  oppId: string | null;
  onStageChanged: () => void;
}

export const OpportunityHeaderView = ({
  opportunity,
  orgId,
  projectId,
  oppId,
  onStageChanged,
}: OpportunityHeaderViewProps) => {
  return (
    <>
      <CardTitle className="flex items-center gap-2 truncate">
        <FolderOpen className="h-5 w-5" />
        {opportunity.title}
      </CardTitle>
      <CardDescription className="truncate">
        {opportunity.organizationName ?? '—'}
      </CardDescription>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <OpportunityStageBadge
          stage={(opportunity.stage as OpportunityStage | undefined) ?? 'IDENTIFIED'}
          orgId={orgId}
          projectId={projectId ?? undefined}
          oppId={oppId ?? undefined}
          editable={!!(orgId && projectId && oppId)}
          onStageChanged={onStageChanged}
        />
        <Badge variant="secondary">{opportunity.source}</Badge>
        {opportunity.type && <Badge variant="outline">{opportunity.type}</Badge>}
        {opportunity.naicsCode && (
          <Badge variant="outline" className="gap-1">
            <Tag className="h-3.5 w-3.5" />
            NAICS {opportunity.naicsCode}
          </Badge>
        )}
        {opportunity.pscCode && <Badge variant="outline">PSC {opportunity.pscCode}</Badge>}
        {opportunity.setAside && <Badge variant="outline">{opportunity.setAside}</Badge>}
        {opportunity.solicitationNumber && (
          <Badge variant="outline">Solicitation {opportunity.solicitationNumber}</Badge>
        )}
        {opportunity.noticeId && <Badge variant="outline">Notice {opportunity.noticeId}</Badge>}
      </div>

      {/* Dates */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          Posted: {formatDateTime(opportunity.postedDateIso)}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          Due: {formatDateTime(opportunity.responseDeadlineIso)}
        </span>
      </div>

      {/* Created/Updated by */}
      {(opportunity.createdByName ?? opportunity.updatedByName) && (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {opportunity.createdByName && (
            <span className="inline-flex items-center gap-1">
              <UserCircle2 className="h-3.5 w-3.5" />
              Created by: <span className="text-foreground/90 ml-1">{opportunity.createdByName}</span>
            </span>
          )}
          {opportunity.updatedByName && opportunity.updatedByName !== opportunity.createdByName && (
            <span className="inline-flex items-center gap-1">
              <UserCircle2 className="h-3.5 w-3.5" />
              Updated by: <span className="text-foreground/90 ml-1">{opportunity.updatedByName}</span>
            </span>
          )}
        </div>
      )}
    </>
  );
};

interface OpportunityDescriptionProps {
  description: string;
  /** Maximum number of lines before collapsing (default: 6) */
  maxLines?: number;
}

/** Line height in px for computing max-height (approx. 1.5rem = 24px) */
const LINE_HEIGHT_PX = 24;

export const OpportunityDescription = ({ description, maxLines = 6 }: OpportunityDescriptionProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldShowToggle, setShouldShowToggle] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Check if content exceeds max height on mount and when description changes
  useEffect(() => {
    if (contentRef.current) {
      const contentHeight = contentRef.current.scrollHeight;
      const maxHeight = maxLines * LINE_HEIGHT_PX;
      setShouldShowToggle(contentHeight > maxHeight);
    }
  }, [description, maxLines]);

  const collapsedMaxHeight = maxLines * LINE_HEIGHT_PX;

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          'prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed overflow-hidden transition-all duration-300',
          '[&_p]:mb-2 [&_p:last-child]:mb-0',
          '[&_ul]:mb-2 [&_ul]:pl-5 [&_ul>li]:list-disc [&_ul>li]:mb-0.5',
          '[&_ol]:mb-2 [&_ol]:pl-5 [&_ol>li]:list-decimal [&_ol>li]:mb-0.5',
          '[&_strong]:font-semibold [&_strong]:text-foreground',
          '[&_b]:font-semibold [&_b]:text-foreground',
          '[&_em]:italic',
          '[&_u]:underline',
          '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1',
          '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1',
          '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5',
          '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80',
          '[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:mb-2',
          '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left',
          '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
          '[&_hr]:border-border [&_hr]:my-2'
        )}
        style={{
          maxHeight: isExpanded ? 'none' : `${collapsedMaxHeight}px`,
        }}
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(description, {
            ALLOWED_TAGS: [
              'p',
              'br',
              'div',
              'span',
              'strong',
              'b',
              'em',
              'i',
              'u',
              's',
              'h1',
              'h2',
              'h3',
              'h4',
              'h5',
              'h6',
              'ul',
              'ol',
              'li',
              'a',
              'blockquote',
              'code',
              'pre',
              'hr',
              'table',
              'thead',
              'tbody',
              'tr',
              'th',
              'td',
            ],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
            FORCE_BODY: true,
          }),
        }}
      />
      
      {/* Gradient fade when collapsed */}
      {shouldShowToggle && !isExpanded && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none" />
      )}
      
      {/* Show more/less button */}
      {shouldShowToggle && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show more
            </>
          )}
        </button>
      )}
    </div>
  );
};
