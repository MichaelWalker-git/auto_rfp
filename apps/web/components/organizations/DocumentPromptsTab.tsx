'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { DocumentPromptItem, DocumentPromptType, PromptScope } from '@auto-rfp/core';
import {
  DocumentPromptTypeSchema,
  RFP_DOCUMENT_TYPES,
  RFP_DOCUMENT_TYPE_DESCRIPTIONS,
} from '@auto-rfp/core';

import {
  DocumentPromptRow,
  type DocumentPromptResetArgs,
  type DocumentPromptSaveArgs,
} from '@/components/organizations/DocumentPromptRow';

/** Overridable types in the win-optimized order of RFP_DOCUMENT_TYPES. */
const ORDERED_DOCUMENT_TYPES: DocumentPromptType[] = (
  Object.keys(RFP_DOCUMENT_TYPES) as (keyof typeof RFP_DOCUMENT_TYPES)[]
).filter((t): t is DocumentPromptType =>
  (DocumentPromptTypeSchema.options as readonly string[]).includes(t),
);

const byScopeKeyMap = (items: DocumentPromptItem[]) => {
  const m = new Map<string, DocumentPromptItem>();
  for (const it of items) m.set(`${it.scope}#${it.documentType}`, it);
  return m;
};

export const DocumentPromptsTab = ({
                                     documentPrompts,
                                     isLoading,
                                     isSaving,
                                     onSave,
                                     onReset,
                                   }: {
  documentPrompts: DocumentPromptItem[];
  isLoading: boolean;
  isSaving: boolean;
  onSave: (args: DocumentPromptSaveArgs) => Promise<void>;
  onReset: (args: DocumentPromptResetArgs) => Promise<void>;
}) => {
  const map = React.useMemo(() => byScopeKeyMap(documentPrompts), [documentPrompts]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[180px] w-full rounded-2xl"/>
        <Skeleton className="h-[180px] w-full rounded-2xl"/>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
        You are editing the document-type guidance and task instructions. Output format,
        template preservation, and tool rules are managed by the system and cannot be
        overridden.
      </div>

      <div className="space-y-10">
        {ORDERED_DOCUMENT_TYPES.map((documentType) => {
          const sys = map.get(`SYSTEM#${documentType}`) ?? null;
          const usr = map.get(`USER#${documentType}`) ?? null;

          return (
            <section key={documentType} className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold">{RFP_DOCUMENT_TYPES[documentType]}</div>
                <p className="text-xs text-muted-foreground">
                  {RFP_DOCUMENT_TYPE_DESCRIPTIONS[documentType]}
                </p>
              </div>

              <div className="space-y-3">
                {(['SYSTEM', 'USER'] as PromptScope[]).map((scope) => (
                  <DocumentPromptRow
                    key={scope}
                    scope={scope}
                    documentType={documentType}
                    current={scope === 'SYSTEM' ? sys : usr}
                    onSave={onSave}
                    onReset={onReset}
                    isSaving={isSaving}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
