'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQAEngagementContext } from './qa-engagement-context';
import { TrendingUp, MessageCircle, Clock, CheckCircle2, CalendarClock, AlertTriangle } from 'lucide-react';

export function EngagementMetricsCard() {
  const { metrics, metricsLoading, metricsError, questionDeadline, deadlinesLoading } = useQAEngagementContext();

  if (metricsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (metricsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Engagement Metrics</CardTitle>
          <CardDescription className="text-destructive">
            Failed to load metrics: {metricsError.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const responseRate = metrics?.responseRate ?? 0;
  const avgResponseTimeDays = metrics?.averageResponseTimeDays ?? 0;
  const totalInteractions = metrics?.totalInteractions ?? 0;
  const questionsSubmitted = metrics?.questionsSubmitted ?? 0;

  // Format deadline date
  const formatDeadlineDate = (dateIso: string) => {
    const date = new Date(dateIso);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Get deadline badge color - use isPast for most reliable expired detection
  const getDeadlineBadgeColor = (isPast: boolean, level: string) => {
    if (isPast) return 'bg-gray-100 text-gray-600 border-gray-300';
    switch (level) {
      case 'expired': return 'bg-gray-100 text-gray-600 border-gray-300';
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'warning': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  return (
    <>
      {/* Question Submission Deadline Banner */}
      {!deadlinesLoading && questionDeadline && (
        <Card className={`mb-4 border-2 ${
          questionDeadline.isPast ? 'border-gray-300 bg-gray-50' :
          questionDeadline.warningLevel === 'urgent' ? 'border-red-300 bg-red-50' :
          questionDeadline.warningLevel === 'warning' ? 'border-orange-300 bg-orange-50' :
          'border-green-300 bg-green-50'
        }`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {questionDeadline.isPast ? (
                  <AlertTriangle className="h-6 w-6 text-red-500" />
                ) : (
                  <CalendarClock className={`h-6 w-6 ${
                    questionDeadline.warningLevel === 'urgent' ? 'text-orange-500' :
                    questionDeadline.warningLevel === 'warning' ? 'text-yellow-600' :
                    'text-green-500'
                  }`} />
                )}
                <div>
                  <p className="font-semibold text-sm">{questionDeadline.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDeadlineDate(questionDeadline.dateIso)}
                  </p>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-full text-sm font-medium border ${getDeadlineBadgeColor(questionDeadline.isPast, questionDeadline.warningLevel)}`}>
                {questionDeadline.isPast 
                  ? `${Math.abs(questionDeadline.daysLeft)} days ago`
                  : questionDeadline.daysLeft === 0 
                    ? 'Due today!'
                    : questionDeadline.daysLeft === 1
                      ? '1 day left'
                      : `${questionDeadline.daysLeft} days left`
                }
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-indigo-500" />
          Engagement Metrics
        </CardTitle>
        <CardDescription>
          Track your relationship-building progress with contracting officers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Total Interactions"
            value={totalInteractions.toString()}
            description="Phone, email, meetings"
          />
          <MetricCard            
            label="Questions Submitted"
            value={questionsSubmitted.toString()}
            description="Clarifying questions sent"
          />
          <MetricCard
            label="Response Rate"
            value={`${Math.round(responseRate * 100)}%`}
            description="Questions answered"
          />
          {/* <MetricCard
            label="Avg Response Time"
            value={avgResponseTimeDays > 0 ? `${avgResponseTimeDays.toFixed(1)}d` : 'N/A'}
            description="CO reply time"
          /> */}
        </div>
      </CardContent>
    </Card>
    </>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  description: string;
}

function MetricCard({ label, value, description }: MetricCardProps) {
  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-center grid subgrid grid-rows-3 gap-0">
      <div className="flex items-center gap-2 text-muted-foreground justify-center">
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  );
}
