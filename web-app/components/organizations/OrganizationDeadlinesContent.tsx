'use client';

import { useParams } from 'next/navigation';
import { CalendarClock, Plus } from 'lucide-react';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import DeadlinesDashboard from '../deadlines/DeadlinesDashboard';

interface OrgDeadlinesProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function OrganizationDeadlinesContent({ params }: OrgDeadlinesProps) {
  const { orgId } = useParams() as { orgId: string };

  const { isLoading } = useKnowledgeBases(orgId);

  if (isLoading) {
    return (
      <div className="container mx-auto p-12">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4 animate-pulse"/>
          <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse"/>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"/>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-12">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CalendarClock className="h-8 w-8"/>
            Deadlines
          </h1>
          <p className="text-gray-600 mt-1">
            Track deadlines for all organization's RFPs
          </p>
          <p>OrgId: {orgId}</p>
        </div>
        
      </div>
      <div>
        <DeadlinesDashboard orgId={orgId}/>
      </div>

    
    </div>
  );
}
