'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, AlertCircle, List, CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeadlines, type GetDeadlinesParams } from '@/lib/hooks/use-deadlines';
import DeadlineCard from './DeadlinesCard';
import DeadlinesCalendar from './DeadlinesCalendar';
import ExportDeadlinesButton from './ExportDeadlinesButton';
import CalendarSubscription from './CalendarSubscription';

interface FlattenedDeadline {
  projectId: string;
  projectName?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  dateTimeIso?: string;
  label?: string;
  type?: string;
  rawText?: string;
  timezone?: string;
  notes?: string;
  isSubmissionDeadline?: boolean;
  daysUntil?: number;
}

interface DeadlinesDashboardProps {
  orgId?: string;
  projectId?: string;
  opportunityId?: string;
  title?: string;
  showFilters?: boolean;
}

type UrgencyFilter = 'all' | 'urgent' | 'upcoming' | 'future' | 'passed';
type ViewMode = 'list' | 'calendar';

// Urgency filter options
const URGENCY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'urgent', label: 'Urgent (≤3 days)' },
  { value: 'upcoming', label: 'Upcoming (≤7 days)' },
  { value: 'future', label: 'Future (> 7 days)' },
  { value: 'passed', label: 'Passed' },
] as const;

// Known deadline types
const DEADLINE_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'PROPOSAL_DUE', label: 'Proposal Due' },
  { value: 'QUESTIONS_DUE', label: 'Questions Due' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'OTHER', label: 'Other' },
] as const;

export default function DeadlinesDashboard({ 
  orgId, 
  projectId,
  opportunityId,
  title,
  showFilters = true,
}: DeadlinesDashboardProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  
  // Filter states
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedOpportunity, setSelectedOpportunity] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  
  // Build params based on what's provided
  const params: GetDeadlinesParams = {
    ...(orgId && { orgId }),
    ...(projectId && { projectId }),
    ...(opportunityId && { opportunityId }),
  };
  
  const { data, isLoading, error } = useDeadlines(params);

  // Flatten all deadlines from all projects into single array
  const allDeadlines: FlattenedDeadline[] = useMemo(() => {
    return data?.deadlines?.flatMap((item) =>
      (item.deadlines ?? []).map((deadline) => ({
        projectId: item.projectId,
        projectName: item.projectName,
        opportunityId: item.opportunityId,
        opportunityTitle: item.opportunityTitle,
        ...deadline,
        isSubmissionDeadline: false,
      })),
    ) ?? [];
  }, [data]);

  // Calculate days until for each deadline
  const deadlinesWithDays: FlattenedDeadline[] = useMemo(() => {
    const now = Date.now();
    return allDeadlines.map((d) => {
      if (!d.dateTimeIso) {
        return { ...d, daysUntil: undefined };
      }
      const deadlineTime = new Date(d.dateTimeIso).getTime();
      const daysUntil = Math.ceil((deadlineTime - now) / (24 * 60 * 60 * 1000));
      return { ...d, daysUntil };
    });
  }, [allDeadlines]);

  // Get unique projects for filter dropdown
  const uniqueProjects = useMemo(() => {
    const projectMap = new Map<string, string>();
    allDeadlines.forEach((d) => {
      if (d.projectId && d.projectName) {
        projectMap.set(d.projectId, d.projectName);
      }
    });
    return Array.from(projectMap.entries()).map(([id, name]) => ({ id, name }));
  }, [allDeadlines]);

  // Get unique opportunities for filter dropdown - filtered by selected project
  const uniqueOpportunities = useMemo(() => {
    const oppMap = new Map<string, string>();
    const deadlinesToUse = selectedProject === 'all' 
      ? allDeadlines 
      : allDeadlines.filter(d => d.projectId === selectedProject);
    
    deadlinesToUse.forEach((d) => {
      if (d.opportunityId && d.opportunityTitle) {
        oppMap.set(d.opportunityId, d.opportunityTitle);
      }
    });
    return Array.from(oppMap.entries()).map(([id, title]) => ({ id, title }));
  }, [allDeadlines, selectedProject]);

  // Apply all filters
  const filteredDeadlines = useMemo(() => {
    let filtered = deadlinesWithDays;

    // Filter by urgency
    if (urgencyFilter === 'urgent') {
      filtered = filtered.filter((d) => d.daysUntil !== undefined && d.daysUntil >= 0 && d.daysUntil <= 3);
    } else if (urgencyFilter === 'upcoming') {
      filtered = filtered.filter((d) => d.daysUntil !== undefined && d.daysUntil >= 0 && d.daysUntil <= 7);
    } else if (urgencyFilter === 'future') {
      filtered = filtered.filter((d) => d.daysUntil !== undefined && d.daysUntil > 7);
    } else if (urgencyFilter === 'passed') {
      filtered = filtered.filter((d) => d.daysUntil !== undefined && d.daysUntil < 0);
    }

    // Filter by selected project
    if (selectedProject !== 'all') {
      filtered = filtered.filter((d) => d.projectId === selectedProject);
    }

    // Filter by selected opportunity
    if (selectedOpportunity !== 'all') {
      filtered = filtered.filter((d) => d.opportunityId === selectedOpportunity);
    }

    // Filter by deadline type
    if (selectedType !== 'all') {
      filtered = filtered.filter((d) => {
        if (selectedType === 'OTHER') {
          // "Other" means any type not in known types
          return !d.type || !DEADLINE_TYPES.slice(1).some(t => t.value === d.type);
        }
        return d.type === selectedType;
      });
    }

    return filtered;
  }, [deadlinesWithDays, urgencyFilter, selectedProject, selectedOpportunity, selectedType]);

  // Separate parsed and unparsed deadlines
  const unparsedDeadlines = filteredDeadlines.filter((d) => !d.dateTimeIso);
  const parsedDeadlines = filteredDeadlines.filter((d) => d.dateTimeIso);

  // Sort by date (nearest first)
  const sortedDeadlines = [...parsedDeadlines].sort((a, b) => {
    const dateA = new Date(a.dateTimeIso!).getTime();
    const dateB = new Date(b.dateTimeIso!).getTime();
    return dateA - dateB;
  });

  // Determine title based on scope
  const getTitle = () => {
    if (title) return title;
    if (opportunityId) return 'Opportunity Deadlines';
    if (projectId) return 'Project Deadlines';
    if (orgId) return 'Organization Deadlines';
    return 'All Deadlines';
  };

  const getDashboardType = (): 'opportunity' | 'project' | 'organization' | 'all' => {
    if (opportunityId) return 'opportunity';
    if (projectId) return 'project';
    if (orgId) return 'organization';
    return 'all';
  };

  // Clear all filters
  const clearFilters = () => {
    setUrgencyFilter('all');
    setSelectedProject('all');
    setSelectedOpportunity('all');
    setSelectedType('all');
  };

  // Check if any filters are active
  const hasActiveFilters = urgencyFilter !== 'all' || selectedProject !== 'all' || selectedOpportunity !== 'all' || selectedType !== 'all';

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
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <CardTitle className="text-lg">
              {getTitle()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredDeadlines.length}{allDeadlines.length !== filteredDeadlines.length && ` of ${allDeadlines.length}`})
              </span>
            </CardTitle>
          </div>

          <div className="flex gap-2 items-center">
            {/* View Toggle */}
            <div className="flex border rounded-md">
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="rounded-r-none"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'calendar' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('calendar')}
                className="rounded-l-none"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>

            <ExportDeadlinesButton
              variant="batch"
              orgId={orgId}
              projectId={projectId}
              size="sm"
              buttonVariant="outline"
            />

            {/* Calendar Subscription - only at org level */}
            {orgId && <CalendarSubscription orgId={orgId} />}
          </div>
        </div>

        {/* Filters Row */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-4 pt-2 border-t">
            
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="urgency-filter" className="text-sm text-muted-foreground">
                Urgency
              </Label>
              <Select value={urgencyFilter} onValueChange={(value) => setUrgencyFilter(value as UrgencyFilter)}>
                <SelectTrigger id="urgency-filter" className="w-[180px]">
                  <SelectValue placeholder="Select urgency" />
                </SelectTrigger>
                <SelectContent>
                  {URGENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project Filter - only show when viewing org-level */}
            {!projectId && uniqueProjects.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="project-filter" className="text-sm text-muted-foreground">
                  Project
                </Label>
                <Select value={selectedProject} onValueChange={(value) => {
                  setSelectedProject(value);
                  // Reset opportunity when project changes
                  setSelectedOpportunity('all');
                }}>
                  <SelectTrigger id="project-filter" className="w-[200px]">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {uniqueProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Opportunity Filter - only show when viewing project-level or org-level */}
            {!opportunityId && uniqueOpportunities.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opportunity-filter" className="text-sm text-muted-foreground">
                  Opportunity
                </Label>
                <Select value={selectedOpportunity} onValueChange={setSelectedOpportunity}>
                  <SelectTrigger id="opportunity-filter" className="w-[200px]">
                    <SelectValue placeholder="Select opportunity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All opportunities</SelectItem>
                    {uniqueOpportunities.map((opp) => (
                      <SelectItem key={opp.id} value={opp.id}>
                        {opp.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-filter" className="text-sm text-muted-foreground">
                Deadline Type
              </Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger id="type-filter" className="w-[160px]">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DEADLINE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground h-9"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      
      <CardContent className="space-y-3">
        {viewMode === 'calendar' ? (
          <DeadlinesCalendar 
            deadlines={filteredDeadlines} 
            displayType={getDashboardType()} 
          />
        ) : (
          <>
            {sortedDeadlines.length > 0 ? (
              sortedDeadlines.map((deadline, idx) => (
                <DeadlineCard
                  key={`${deadline.projectId}-${deadline.type}-${idx}`}
                  deadline={deadline}
                  displayType={getDashboardType()}
                />
              ))
            ) : (
              <div className="text-muted-foreground py-8 text-center text-sm">
                {hasActiveFilters 
                  ? 'No deadlines match the selected filters'
                  : 'No deadlines found'}
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
                    deadline={deadline}
                    displayType={getDashboardType()}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}