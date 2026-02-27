'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useQAEngagementContext } from './qa-engagement-context';
import {
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  MapPin,
  Clock,
  Smile,
  Meh,
  Frown,
} from 'lucide-react';
import type { EngagementLogItem, EngagementType } from '@auto-rfp/core';

const TYPE_ICONS: Record<EngagementType, React.ReactNode> = {
  QUESTION_SUBMITTED: <MessageSquare className="h-4 w-4" />,
  RESPONSE_RECEIVED: <Mail className="h-4 w-4" />,
  PHONE_CALL: <Phone className="h-4 w-4" />,
  MEETING: <Calendar className="h-4 w-4" />,
  SITE_VISIT: <MapPin className="h-4 w-4" />,
  OTHER: <MessageSquare className="h-4 w-4" />,
};

const TYPE_COLORS: Record<EngagementType, string> = {
  QUESTION_SUBMITTED: 'bg-indigo-100 text-indigo-800',
  RESPONSE_RECEIVED: 'bg-green-100 text-green-800',
  PHONE_CALL: 'bg-blue-100 text-blue-800',
  MEETING: 'bg-purple-100 text-purple-800',
  SITE_VISIT: 'bg-amber-100 text-amber-800',
  OTHER: 'bg-gray-100 text-gray-800',
};

const SENTIMENT_ICONS: Record<string, React.ReactNode> = {
  POSITIVE: <Smile className="h-4 w-4 text-green-500" />,
  NEUTRAL: <Meh className="h-4 w-4 text-gray-400" />,
  NEGATIVE: <Frown className="h-4 w-4 text-red-500" />,
};

export function EngagementTimeline() {
  const { engagementLogs, logsLoading, logsError } = useQAEngagementContext();

  if (logsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-indigo-500" />
          Engagement Timeline
        </CardTitle>
        <CardDescription>
          History of interactions with contracting officers
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logsError && (
          <div className="text-destructive text-sm p-3 bg-destructive/10 rounded mb-4">
            {logsError.message}
          </div>
        )}

        {engagementLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>No interactions logged yet.</p>
            <p className="text-sm">Use the form above to log your first interaction.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

            {/* Timeline items */}
            <div className="space-y-6">
              {engagementLogs.map((log) => (
                <TimelineItem key={log.engagementId} log={log} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TimelineItemProps {
  log: EngagementLogItem;
}

function TimelineItem({ log }: TimelineItemProps) {
  const typeIcon = TYPE_ICONS[log.interactionType];
  const typeColor = TYPE_COLORS[log.interactionType];
  const sentimentIcon = log.sentiment ? SENTIMENT_ICONS[log.sentiment] : null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="relative pl-5 mb-2">
      {/* Timeline dot */}
      <div className="absolute left-2 w-5 h-5 bg-background border-2 border-indigo-500 rounded-full flex items-center justify-center">
        <div className="w-2 h-2 bg-indigo-500 rounded-full" />
      </div>

      {/* Content */}
      <div className="bg-muted/30 rounded-lg p-4 space-y-2 border border-transparent transition-colors hover:bg-muted/50 hover:border-border cursor-default">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge className={typeColor}>
              {typeIcon}
              <span className="ml-1">{formatEngagementType(log.interactionType)}</span>
            </Badge>
            {sentimentIcon && (
              <span title={`Sentiment: ${log.sentiment}`}>{sentimentIcon}</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {formatDate(log.interactionDate)}
          </span>
        </div>

        {log.contactName && (
          <div className="text-sm">
            <span className="text-muted-foreground">Contact:</span>{' '}
            <span className="font-medium">{log.contactName}</span>
            {log.contactRole && (
              <span className="text-muted-foreground"> ({log.contactRole})</span>
            )}
          </div>
        )}

        <p className="text-sm">{log.summary}</p>

        {log.followUpRequired && log.followUpDate && (
          <div className="text-xs text-amber-600 flex items-center gap-1 mt-2">
            <Calendar className="h-3 w-3" />
            Follow-up: {new Date(log.followUpDate).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}

function formatEngagementType(type: EngagementType): string {
  const labels: Record<EngagementType, string> = {
    QUESTION_SUBMITTED: 'Question Submitted',
    RESPONSE_RECEIVED: 'Response Received',
    PHONE_CALL: 'Phone Call',
    MEETING: 'Meeting',
    SITE_VISIT: 'Site Visit',
    OTHER: 'Other',
  };
  return labels[type] ?? type;
}
