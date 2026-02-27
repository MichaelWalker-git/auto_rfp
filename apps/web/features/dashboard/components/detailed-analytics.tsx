'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import type { GetAnalyticsResponse, MonthlyAnalytics } from '@auto-rfp/core';
import { LOSS_REASON_LABELS } from '@auto-rfp/core';

interface DetailedAnalyticsProps {
  data: GetAnalyticsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#6366f1', '#8b5cf6', '#ec4899', '#94a3b8', '#14b8a6', '#10b981', '#3b82f6', '#f59e0b', '#84cc16'];

const formatMonth = (month: string) => {
  const [year, mon] = month.split('-');
  const date = new Date(Number(year), Number(mon) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

export const DetailedAnalytics = ({ data, isLoading, isError }: DetailedAnalyticsProps) => {
  const analytics = data?.analytics ?? [];
  const summary = data?.summary;

  // Win rate trend over time
  const winRateTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Win Rate': Number(m.winRate.toFixed(1)),
        'Submission Rate': Number(m.submissionRate.toFixed(1)),
      })),
    [analytics],
  );

  // Volume trend
  const volumeTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        Total: m.totalProjects,
        Submitted: m.projectsSubmitted,
        Won: m.projectsWon,
        Lost: m.projectsLost,
      })),
    [analytics],
  );

  // Loss reason breakdown from summary
  const lossReasonData = useMemo(() => {
    if (!summary?.lossReasonCounts) return [];
    return Object.entries(summary.lossReasonCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => ({
        name: LOSS_REASON_LABELS[reason as keyof typeof LOSS_REASON_LABELS] ?? reason,
        value: count,
      }));
  }, [summary]);

  // Time metrics trend
  const timeTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Time to Submit': Number(m.averageTimeToSubmit.toFixed(1)),
        'Time to Decision': Number(m.averageTimeToDecision.toFixed(1)),
      })),
    [analytics],
  );

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load analytics data. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const noData = !isLoading && analytics.length === 0;

  return (
    <div className="space-y-6">
      {/* Win Rate & Submission Rate Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Win Rate & Submission Rate Trend</CardTitle>
          <CardDescription>Monthly performance rates over the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : noData ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
              No data available for the selected period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart data={winRateTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="winRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="subRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(v: number) => `${v}%`}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--background))',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="Win Rate"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#winRateGrad)"
                  dot={{ r: 3 }}
                />
                <Area
                  type="monotone"
                  dataKey="Submission Rate"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#subRateGrad)"
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Volume Trend + Loss Reasons */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Volume Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Volume Trend</CardTitle>
            <CardDescription>Monthly project counts by status</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : noData ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={volumeTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--background))',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Total" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Submitted" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Won" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Lost" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Loss Reason Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Loss Reason Breakdown</CardTitle>
            <CardDescription>Why proposals were lost in the period</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : lossReasonData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No loss data available
              </div>
            ) : (
              <div className="flex gap-4 items-center">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={lossReasonData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {lossReasonData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--background))',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {lossReasonData.slice(0, 8).map((item, index) => (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <div
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground">{item.name}</span>
                      <span className="ml-auto font-medium shrink-0">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time Metrics Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time Metrics Trend</CardTitle>
          <CardDescription>Average days to submit and receive decision</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : noData ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              No data available for the selected period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <AreaChart data={timeTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="submitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="decisionGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" d" />
                <Tooltip
                  formatter={(v: number) => `${v} days`}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--background))',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="Time to Submit"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#submitGrad)"
                  dot={{ r: 3 }}
                />
                <Area
                  type="monotone"
                  dataKey="Time to Decision"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#decisionGrad)"
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
