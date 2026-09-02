'use client';

import type { NotaryRequirement } from '@auto-rfp/core';
import { cueLabel } from '../lib/notary-ui';

interface NotaryTriggerListProps {
  requirements: NotaryRequirement[];
}

/**
 * Expandable evidence list for a notary badge (FR5.2). One row per detected
 * requirement showing where it was found, the verbatim triggering text, the
 * cue that matched, and the model rationale when present.
 *
 * SEC.1: every document-derived string (`triggeringText`, `documentName`,
 * `rationale`) is rendered as a plain React text node — NEVER via
 * `dangerouslySetInnerHTML` — so any HTML/script in the source is escaped and
 * inert.
 */
export const NotaryTriggerList = ({ requirements }: NotaryTriggerListProps) => {
  if (requirements.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No trigger detail available.
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {requirements.map((req, index) => {
        // Locator: an explicit form page when present, else the document/section name.
        const locator =
          req.pageNumber != null ? `Page ${req.pageNumber}` : req.documentName;
        return (
          <li
            key={`${req.formId ?? req.documentName}-${req.cue}-${index}`}
            data-testid="notary-trigger-row"
            className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
              <span className="font-medium text-foreground">{locator}</span>
              <span>·</span>
              <span>{cueLabel(req.cue)}</span>
            </div>
            <p className="mt-1 text-foreground break-words whitespace-pre-wrap">
              “{req.triggeringText}”
            </p>
            {req.rationale && (
              <p className="mt-1 text-muted-foreground break-words">
                {req.rationale}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
};
