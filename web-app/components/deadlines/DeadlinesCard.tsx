import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import ExportDeadlinesButton from './ExportDeadlinesButton';
import { useOrganization } from '@/context/organization-context';

interface StatusObject {
  message: string,
  variant: 'default' | 'secondary' | 'destructive' | 'outline' | null | undefined,
  status: string | null | undefined,
  statusColor: string | undefined
}

export default function DeadlineCard({ deadline, displayType }: {
  deadline: any,
  displayType: 'project' | 'organization' | 'all'
}) {
  const { currentOrganization } = useOrganization();
  const dt = deadline?.dateTimeIso ? new Date(deadline.dateTimeIso) : null;
  const isPassed = dt && (dt.getTime() - Date.now()) < 0;
  const isUrgent = dt && !isPassed && (dt.getTime() - Date.now()) < 7 * 24 * 60 * 60 * 1000;

  const daysUntil = dt
    ? Math.ceil((dt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const showStatusBadges = dt ? daysUntil !== null : true;

  const statusObj: StatusObject = {
    variant: null,
    message: '',
    status: null,
    statusColor: 'bg-green-600'
  };

  // Calculate recommended submit time (24 hours early)
  const recommendedSubmitBy = dt
    ? new Date(dt.getTime() - 24 * 60 * 60 * 1000)
    : null;

  if (!dt) {
    statusObj.message = 'Unparsed date';
    statusObj.variant = 'outline';
    statusObj.status = 'Needs review';
    statusObj.statusColor = 'bg-amber-500';
  } else if (daysUntil && daysUntil > 0) {
    statusObj.message = `${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
    statusObj.variant = daysUntil > 3 ? 'default' : 'destructive';
    statusObj.status = daysUntil > 3 && daysUntil < 7 ? 'Upcoming' : (daysUntil < 3 ? 'Urgent' : 'Future');
    statusObj.statusColor = daysUntil > 3 && daysUntil < 7 ? 'bg-orange-400' : (daysUntil < 3 ? 'bg-red-600' : 'bg-green-600');
  } else if (daysUntil && daysUntil < 0) {
    statusObj.message = 'Date passed';
    statusObj.variant = 'secondary';
    statusObj.status = 'Passed';
    statusObj.statusColor = 'bg-gray-400';
  } else {
    statusObj.message = 'Due Today!';
    statusObj.variant = 'destructive';
    statusObj.status = 'Urgent';
    statusObj.statusColor = 'bg-red-600';
  }

  function formatDate(value?: string) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  function formatDateTime(date: Date): string {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // Map deadline type to export filter
  const getDeadlineType = (): 'submission' | 'questions' | 'site-visit' | undefined => {
    if (deadline.type === 'PROPOSAL_DUE') return 'submission';
    if (deadline.type === 'QUESTIONS_DUE') return 'questions';
    if (deadline.type === 'SITE_VISIT') return 'site-visit';
    return undefined;
  };

  // Show recommended submission time for submission deadlines
  const showRecommendedTime = getDeadlineType() === 'submission' && recommendedSubmitBy;
  const notes =
    deadline.notes === 'UNPARSED_DATE'
      ? 'Found deadline text but could not parse a datetime.'
      : deadline.notes;

  return (
    <div
      className={`rounded-lg border p-4 transition-all hover:shadow-md  border-${statusObj.variant} bg-${statusObj.variant}/5 `}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          {displayType !== 'project' && (
            <div>
              {`Project: `}
              <Link href={`/organizations/${currentOrganization?.id}/projects/${deadline.projectId}`} className="font-bold mb-4 inline-block">
                {deadline.projectName}
              </Link>
            </div>
          )}
          <div className="font-medium flex items-center gap-2">
            {isUrgent && <AlertTriangle className="h-4 w-4 text-destructive"/>}
            {deadline.label || deadline.type || 'Deadline'}
          </div>
          {notes && (
            <div className="mt-2 text-sm text-muted-foreground">
              {notes}
            </div>
          )}

          {/* Recommended submission time */}
          {showRecommendedTime && (
            <div
              className="mt-3 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0"/>
              <div className="text-sm">
                <div className="font-medium text-amber-900 dark:text-amber-100">
                  Recommended: Submit 24 hours early
                </div>
                <div className="text-amber-700 dark:text-amber-300 mt-1">
                  {formatDateTime(recommendedSubmitBy)}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">
            {dt ? formatDate(deadline.dateTimeIso) : deadline.rawText || '—'}
          </div>
          {showStatusBadges && (<div className="flex items-center justify-end gap-2">
              <Badge className={`${statusObj.statusColor} mt-1`}>
                {statusObj.status}
              </Badge>
              <Badge variant={statusObj.variant} className="mt-1">
                {statusObj.message}
              </Badge>
            </div>
          )}
          {deadline.timezone && <div className="text-xs text-muted-foreground mt-1">{deadline.timezone}</div>}

          {deadline.dateTimeIso && deadline.projectId && (
            <ExportDeadlinesButton
              variant="single"
              projectId={deadline.projectId}
              deadlineType={getDeadlineType()}
              size="sm"
              buttonVariant="ghost"
            />
          )}
        </div>
      </div>
    </div>
  );
}
