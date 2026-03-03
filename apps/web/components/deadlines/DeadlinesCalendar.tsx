'use client';

import { useMemo, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, differenceInDays } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, Clock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useCurrentOrganization } from '@/context/organization-context';
import ExportDeadlinesButton from './ExportDeadlinesButton';

import 'react-big-calendar/lib/css/react-big-calendar.css';

// Setup date-fns localizer for react-big-calendar
const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

// Types
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
  daysUntil?: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  deadline: FlattenedDeadline;
  urgency: 'urgent' | 'warning' | 'upcoming' | 'passed';
}

interface DeadlinesCalendarProps {
  deadlines: FlattenedDeadline[];
  displayType: 'opportunity' | 'project' | 'organization' | 'all';
}

function getUrgency(daysUntil: number | undefined): 'urgent' | 'warning' | 'upcoming' | 'passed' {
  if (daysUntil === undefined) return 'upcoming';
  if (daysUntil < 0) return 'passed';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 7) return 'warning';
  return 'upcoming';
}

const urgencyColors: Record<string, { bg: string; border: string; text: string }> = {
  urgent: {
    bg: 'bg-red-500',
    border: 'border-red-600',
    text: 'text-white',
  },
  warning: {
    bg: 'bg-orange-500',
    border: 'border-orange-600',
    text: 'text-white',
  },
  upcoming: {
    bg: 'bg-green-500',
    border: 'border-green-600',
    text: 'text-white',
  },
  passed: {
    bg: 'bg-gray-400',
    border: 'border-gray-500',
    text: 'text-white',
  },
};

// Custom event component for the calendar
function EventComponent({ event }: { event: CalendarEvent }) {
  const colors = urgencyColors[event.urgency];
  
  return (
    <div
      className={`px-1 py-0.5 rounded text-xs truncate ${colors.bg} ${colors.text}`}
      title={`${event.title} - ${event.deadline.projectName}`}
    >
      {event.title}
    </div>
  );
}

export default function DeadlinesCalendar({ deadlines, displayType }: DeadlinesCalendarProps) {
  const { currentOrganization } = useCurrentOrganization();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [currentView, setCurrentView] = useState<typeof Views[keyof typeof Views]>(Views.MONTH);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Transform deadlines into calendar events
  const events: CalendarEvent[] = useMemo(() => {
    return deadlines
      .filter((d) => d.dateTimeIso) 
      .map((deadline, idx) => {
        const date = new Date(deadline.dateTimeIso!);
        const now = new Date();
        const daysUntil = differenceInDays(date, now);
        const urgency = getUrgency(daysUntil);
        
        return {
          id: `${deadline.projectId}-${deadline.type}-${idx}`,
          title: deadline.label || deadline.type || 'Deadline',
          start: date,
          end: new Date(date.getTime() + 60 * 60 * 1000), 
          deadline: { ...deadline, daysUntil },
          urgency,
        };
      });
  }, [deadlines]);

  // Handle event selection
  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  // Custom event styling
  const eventStyleGetter = useCallback((event: CalendarEvent) => {
    return {
      style: {
        backgroundColor: event.urgency === 'urgent' ? '#ef4444' :
                         event.urgency === 'warning' ? '#f97316' :
                         event.urgency === 'upcoming' ? '#22c55e' :
                         '#9ca3af',
        borderColor: event.urgency === 'urgent' ? '#dc2626' :
                     event.urgency === 'warning' ? '#ea580c' :
                     event.urgency === 'upcoming' ? '#16a34a' :
                     '#6b7280',
        color: 'white',
        borderRadius: '4px',
        border: '1px solid',
        fontSize: '0.75rem',
      },
    };
  }, []);

  // Format functions for event details
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'EEEE, MMMM d, yyyy \'at\' h:mm a');
  };

  const getUrgencyBadge = (urgency: string, daysUntil?: number) => {
    const config = {
      urgent: { label: 'Urgent', variant: 'destructive' as const },
      warning: { label: 'This Week', variant: 'default' as const },
      upcoming: { label: 'Upcoming', variant: 'secondary' as const },
      passed: { label: 'Passed', variant: 'outline' as const },
    };
    const { label, variant } = config[urgency as keyof typeof config] || config.upcoming;
    
    return (
      <Badge variant={variant} className={urgencyColors[urgency].bg}>
        {label}
        {daysUntil !== undefined && daysUntil >= 0 && (
          <span className="ml-1">
            ({daysUntil === 0 ? 'Today' : `${daysUntil}d`})
          </span>
        )}
      </Badge>
    );
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          {/* Legend */}
          <div className="flex items-center gap-4 p-4 border-b bg-muted/30">
            <span className="text-sm font-medium text-muted-foreground">Urgency:</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-500" />
                <span className="text-xs">≤3 days</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-orange-500" />
                <span className="text-xs">4-7 days</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-green-500" />
                <span className="text-xs">&gt;7 days</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-gray-400" />
                <span className="text-xs">Passed</span>
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="h-[600px] p-4">
            <Calendar<CalendarEvent>
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              view={currentView}
              onView={setCurrentView}
              date={currentDate}
              onNavigate={setCurrentDate}
              views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
              popup
              selectable={false}
              components={{
                event: EventComponent,
              }}
              style={{ height: '100%' }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Event Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedEvent?.urgency === 'urgent' && (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
              {selectedEvent?.title}
            </DialogTitle>
          </DialogHeader>
          
          {selectedEvent && (
            <div className="space-y-4">
              <div>
                {getUrgencyBadge(selectedEvent.urgency, selectedEvent.deadline.daysUntil)}
              </div>

              {displayType !== 'project' && displayType !== 'opportunity' && selectedEvent.deadline.projectName && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">Project</div>
                  <Link
                    href={`/organizations/${currentOrganization?.id}/projects/${selectedEvent.deadline.projectId}`}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {selectedEvent.deadline.projectName}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}

              {displayType !== 'opportunity' && selectedEvent.deadline.opportunityTitle && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">Opportunity</div>
                  <Link
                    href={`/organizations/${currentOrganization?.id}/projects/${selectedEvent.deadline.projectId}/opportunities/${selectedEvent.deadline.opportunityId}`}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {selectedEvent.deadline.opportunityTitle}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Date & Time
                </div>
                <div className="text-sm">
                  {formatDateTime(selectedEvent.deadline.dateTimeIso!)}
                </div>
                {selectedEvent.deadline.timezone && (
                  <div className="text-xs text-muted-foreground">
                    Timezone: {selectedEvent.deadline.timezone}
                  </div>
                )}
              </div>

              {selectedEvent.deadline.type && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">Type</div>
                  <Badge variant="outline">{selectedEvent.deadline.type}</Badge>
                </div>
              )}

              {selectedEvent.deadline.notes && selectedEvent.deadline.notes !== 'UNPARSED_DATE' && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">Notes</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedEvent.deadline.notes}
                  </div>
                </div>
              )}

              {/* Recommended Submit Time (for submission deadlines) */}
              {selectedEvent.deadline.type === 'PROPOSAL_DUE' && selectedEvent.deadline.dateTimeIso && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 text-amber-600 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-amber-900 dark:text-amber-100">
                        Recommended: Submit 24 hours early
                      </div>
                      <div className="text-amber-700 dark:text-amber-300 mt-1">
                        {format(
                          new Date(new Date(selectedEvent.deadline.dateTimeIso).getTime() - 24 * 60 * 60 * 1000),
                          'EEEE, MMMM d, yyyy \'at\' h:mm a'
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <ExportDeadlinesButton
                  variant="single"
                  projectId={selectedEvent.deadline.projectId}
                  size="sm"
                  buttonVariant="outline"
                />
                <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}