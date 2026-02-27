'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { QAEngagementView } from '@/components/qa-engagement/QAEngagementView';

export default function QAEngagementPage() {
  const params = useParams<{ orgId: string; projectId: string; oppId: string }>();
  const { orgId, projectId, oppId } = params;

  return (
    <div className="container mx-auto p-6">
      <QAEngagementView
        orgId={orgId}
        projectId={projectId}
        opportunityId={oppId}
      />
    </div>
  );
}
