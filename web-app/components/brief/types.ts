import React from 'react';

export type SectionKey = 'summary' | 'deadlines' | 'contacts' | 'requirements' | 'risks' | 'pastPerformance' | 'scoring';
export type SectionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | undefined;

export const SECTION_ORDER: SectionKey[] = [
  'summary',
  'deadlines',
  'contacts',
  'requirements',
  'risks',
  'pastPerformance',
  'scoring',
];

export type Props = {
  projectId: string;
  orgId?: string;
  questionFileId?: string;
};

export type TooltipInfo = {
  title: string;
  description?: string;
};

export type SectionMeta = {
  key: SectionKey;
  title: string;
  icon: React.ReactNode;
};