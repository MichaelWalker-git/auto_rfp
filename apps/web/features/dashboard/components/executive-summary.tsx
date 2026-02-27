'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Award,
  DollarSign,
  FileText,
  Target,
  TrendingUp,
} from 'lucide-react';
import { KpiCard } from './kpi-card';
import type { GetAnalyticsResponse, MonthlyAnalytics } from '@auto-rfp/core';

interface ExecutiveSummaryProps {
  data: GetAnalyticsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

const formatCurrency = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatMonth = (month: string) => {
  const [year, mon] = month.split('-');
  const date = new Date(Number(year), Number(mon) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

export const ExecutiveSummary = ({ data, isLoading, isError }: ExecutiveSummaryProps) => {
  const summary = data?.summary;
  const analytics = data?.analytics ?? [];

  // Build chart data from monthly analytics
  const winLossChartData = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        Won: m.projectsWon,
        Lost: m.projectsLost,
        'No Bid': m.projectsNoBid,
        winRate: Number(m.winRate.toFixed(1)),
      })),
    [analytics],
  );

  const pipelineChartData = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Pipeline Value': Math.round(m.totalPipelineValue),
        'Won Value': Math.round(m.totalWonValue),
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

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Overall Win Rate"
          value={isLoading ? '—' : `${summary?.winRate?.toFixed(1) ?? 0}%`}
          description={`${summary?.totalWon ?? 0} won / ${summary?.totalLost ?? 0} lost`}
          icon={Award}
          isLoading={isLoading}
          valueClassName={
            (summary?.winRate ?? 0) >= 50 ? 'text-emerald-600' : 'text-foreground'
          }
        />
        <KpiCard
          title="Total Pipeline Value"
          value={isLoading ? '—' : formatCurrency(summary?.totalPipelineValue ?? 0)}
          description={`${summary?.totalProjects ?? 0} total projects`}
          icon={DollarSign}
          isLoading={isLoading}
        />
        <KpiCard
          title="Won Contract Value"
          value={isLoading ? '—' : formatCurrency(summary?.totalWonValue ?? 0)}
          description={`Avg ${formatCurrency(summary?.averageContractValue ?? 0)} per deal`}
          icon={TrendingUp}
          isLoading={isLoading}
          valueClassName="text-emerald-600"
        />
        <KpiCard
          title="Submission Rate"
          value={isLoading ? '—' : `${summary?.submissionRate?.toFixed(1) ?? 0}%`}
          description={`${summary?.totalSubmitted ?? 0} submitted`}
          icon={FileText}
          isLoading={isLoading}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Avg Time to Submit"
          value={isLoading ? '—' : `${summary?.averageTimeToSubmit?.toFixed(1) ?? 0} days`}
          description="from project creation"
          icon={Target}
          isLoading={isLoading}
        />
        <KpiCard
          title="Avg Time to Decision"
          value={isLoading ? '—' : `${summary?.averageTimeToDecision?.toFixed(1) ?? 0} days`}
          description="from submission to award"
          icon={Target}
          isLoading={isLoading}
        />
        <KpiCard
          title="Projects Tracked"
          value={isLoading ? '—' : summary?.totalProjects ?? 0}
          description={`${summary?.monthCount ?? 0}-month period`}
          icon={FileText}
          isLoading={isLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Win / Loss Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Win / Loss by Month</CardTitle>
            <CardDescription>Monthly breakdown of project outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : analytics.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No data available for the selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={winLossChartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
                  <Bar dataKey="Won" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Lost" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="No Bid" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Value Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline vs Won Value</CardTitle>
            <CardDescription>Monthly contract value trends</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : analytics.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No data available for the selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <LineChart data={pipelineChartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--background))',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="Pipeline Value"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Won Value"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Stats */}
      {!isLoading && summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Period Summary</CardTitle>
            <CardDescription>
              {summary.periodStart} → {summary.periodEnd} ({summary.monthCount} months)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Badge variant="default" className="text-sm px-3 py-1">
                {summary.totalWon} Won
              </Badge>
              <Badge variant="destructive" className="text-sm px-3 py-1">
                {summary.totalLost} Lost
              </Badge>
              <Badge variant="secondary" className="text-sm px-3 py-1">
                {summary.totalNoBid} No Bid
              </Badge>
              <Badge variant="outline" className="text-sm px-3 py-1">
                {summary.totalSubmitted} Submitted
              </Badge>
              <Badge variant="outline" className="text-sm px-3 py-1">
                {summary.totalProjects} Total Projects
              </Badge>
              {summary.topLossReason && (
                <Badge variant="outline" className="text-sm px-3 py-1 border-destructive/50 text-destructive">
                  Top Loss: {summary.topLossReason.replace(/_/g, ' ')}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
