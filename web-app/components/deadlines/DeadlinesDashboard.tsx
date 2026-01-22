'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Filter, AlertCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeadlines, type GetDeadlinesParams } from '@/lib/hooks/use-deadlines';
import DeadlineCard from './DeadlinesCard';
import ExportDeadlinesButton from './ExportDeadlinesButton';

interface FlattenedDeadline {
  projectId: string;
  projectName?: string;
  dateTimeIso?: string;
  label?: string;
  type?: string;
  rawText?: string;
  timezone?: string;
  notes?: string;
  isSubmissionDeadline?: boolean;
}

interface DeadlinesDashboardProps {
  orgId?: string;
  projectId?: string;
  title?: string;
  showFilters?: boolean;
}

type FilterMode = 'all' | 'urgent' | 'upcoming';

export default function DeadlinesDashboard({ 
  orgId, 
  projectId, 
  title,
  showFilters = true,
}: DeadlinesDashboardProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  
  // Build params based on what's provided
  const params: GetDeadlinesParams = {
    ...(orgId && { orgId }),
    ...(projectId && { projectId }),
    ...(filterMode === 'urgent' && { urgentOnly: true }),
  };
  
  const { data, isLoading, error } = useDeadlines(params);

  // Flatten all deadlines from all projects into single array
  const allDeadlines: FlattenedDeadline[] =
    data?.deadlines?.flatMap((item) =>
      (item.deadlines ?? []).map((deadline) => ({
        projectId: item.projectId,
        projectName: item.projectName,
        ...deadline,
        isSubmissionDeadline: false,
      })),
    ) ?? [];
  const unparsedDeadlines = allDeadlines.filter((d) => !d.dateTimeIso);
  const now = Date.now();
  const deadlinesWithDays = allDeadlines.flatMap((d) => {
    if (!d.dateTimeIso) {
      return [];
    }
    const deadlineTime = new Date(d.dateTimeIso).getTime();
    const daysUntil = Math.ceil((deadlineTime - now) / (24 * 60 * 60 * 1000));
    return [{ ...d, daysUntil }];
  });

  // Apply client-side filters
  let filteredDeadlines = deadlinesWithDays;

  if (filterMode === 'urgent') {
    filteredDeadlines = deadlinesWithDays.filter((d) => d.daysUntil <= 7 && d.daysUntil >= 0);
  } else if (filterMode === 'upcoming') {
    filteredDeadlines = deadlinesWithDays.filter((d) => d.daysUntil >= 0);
  }

  // Sort by date (nearest first)
  const sortedDeadlines = filteredDeadlines
    .sort((a, b) => {
      const dateA = new Date(a.dateTimeIso!).getTime();
      const dateB = new Date(b.dateTimeIso!).getTime();
      return dateA - dateB; 
    });

  // Determine title based on scope
  const getTitle = () => {
    if (title) return title;
    if (projectId) return 'Project Deadlines';
    if (orgId) return 'Organization Deadlines';
    return 'All Deadlines';
  };

  const getDashboardType = (): 'project' | 'organization' | 'all' => {
    if (projectId) return 'project';
    if (orgId) return 'organization';
    return 'all';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading deadlines...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div className="text-sm">Failed to load deadlines</div>
            <div className="text-xs text-muted-foreground">{error.message}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

    return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <CardTitle className="text-lg">
              {getTitle()}
              {sortedDeadlines.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({sortedDeadlines.length} {filterMode !== 'all' && filterMode})
                </span>
              )}
            </CardTitle>
          </div>

          <div className="flex gap-2">
            <ExportDeadlinesButton
              variant="batch"
              orgId={orgId}
              projectId={projectId}
              size="sm"
              buttonVariant="outline"
            />
          
            {showFilters && (
              <div className="flex gap-2">
                <Button
                  variant={filterMode === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterMode('all')}
                >
                  All
                </Button>
                <Button
                  variant={filterMode === 'urgent' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterMode('urgent')}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Urgent
                </Button>
                <Button
                  variant={filterMode === 'upcoming' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterMode('upcoming')}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Upcoming
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {sortedDeadlines.length > 0 ? (
          sortedDeadlines.map((deadline, idx) => (
            <DeadlineCard
              key={`${deadline.projectId}-${deadline.type}-${idx}`}
              deadline={deadline} displayType={getDashboardType()}
            />
          ))
        ) : (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {filterMode === 'urgent' && 'No urgent deadlines (< 7 days)'}
            {filterMode === 'upcoming' && 'No upcoming deadlines (next 30 days)'}
            {filterMode === 'all' && 'No deadlines found'}
          </div>
        )}

        {unparsedDeadlines.length > 0 && (
          <div className="pt-4 border-t space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">
              Unparsed deadlines (manual review needed)
            </div>
            {unparsedDeadlines.map((deadline, idx) => (
              <DeadlineCard
                key={`unparsed-${deadline.projectId}-${deadline.type}-${idx}`}
                deadline={deadline} displayType={getDashboardType()}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
