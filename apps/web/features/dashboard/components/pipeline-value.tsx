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
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, DollarSign, TrendingUp, Briefcase, Target } from 'lucide-react';
import { KpiCard } from './kpi-card';
import type { GetAnalyticsResponse, MonthlyAnalytics } from '@auto-rfp/core';

interface PipelineValueProps {
  data: GetAnalyticsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

const STAGE_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f97316', '#94a3b8'];

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

export const PipelineValue = ({ data, isLoading, isError }: PipelineValueProps) => {
  const analytics = data?.analytics ?? [];
  const summary = data?.summary;

  // Pipeline value over time
  const pipelineTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Total Pipeline': Math.round(m.totalPipelineValue),
        'Won Value': Math.round(m.totalWonValue),
        'Lost Value': Math.round(m.totalLostValue),
      })),
    [analytics],
  );

  // Average contract value trend
  const avgValueTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Avg Contract Value': Math.round(m.averageContractValue),
      })),
    [analytics],
  );

  // Opportunity stage breakdown (derived from project statuses)
  const stageData = useMemo(() => {
    if (!summary) return [];
    const stages = [
      { name: 'Won', value: summary.totalWon, color: '#10b981' },
      { name: 'Lost', value: summary.totalLost, color: '#ef4444' },
      { name: 'No Bid', value: summary.totalNoBid, color: '#94a3b8' },
      {
        name: 'Active / Pending',
        value: Math.max(0, summary.totalProjects - summary.totalWon - summary.totalLost - summary.totalNoBid),
        color: '#6366f1',
      },
    ].filter((s) => s.value > 0);
    return stages;
  }, [summary]);

  // Expected value (win-rate adjusted pipeline)
  const expectedValue = useMemo(() => {
    if (!summary) return 0;
    const activePipeline = summary.totalPipelineValue - summary.totalWonValue - summary.totalLostValue;
    const winRate = summary.winRate / 100;
    return Math.round(activePipeline * winRate);
  }, [summary]);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load pipeline data. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const noData = !isLoading && analytics.length === 0;

  return (
    <div className="space-y-6">
      {/* Pipeline KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Pipeline Value"
          value={isLoading ? '—' : formatCurrency(summary?.totalPipelineValue ?? 0)}
          description="all tracked opportunities"
          icon={DollarSign}
          isLoading={isLoading}
        />
        <KpiCard
          title="Expected Value"
          value={isLoading ? '—' : formatCurrency(expectedValue)}
          description={`win-rate adjusted (${summary?.winRate?.toFixed(0) ?? 0}%)`}
          icon={Target}
          isLoading={isLoading}
          valueClassName="text-indigo-600"
        />
        <KpiCard
          title="Won Contract Value"
          value={isLoading ? '—' : formatCurrency(summary?.totalWonValue ?? 0)}
          description="closed and awarded"
          icon={TrendingUp}
          isLoading={isLoading}
          valueClassName="text-emerald-600"
        />
        <KpiCard
          title="Avg Deal Size"
          value={isLoading ? '—' : formatCurrency(summary?.averageContractValue ?? 0)}
          description="per contract"
          icon={Briefcase}
          isLoading={isLoading}
        />
      </div>

      {/* Pipeline Value Over Time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Value Over Time</CardTitle>
          <CardDescription>Monthly breakdown of total, won, and lost contract values</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : noData ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
              No pipeline data available for the selected period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={288}>
              <BarChart data={pipelineTrend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatCurrency(v)} />
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
                <Bar dataKey="Total Pipeline" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Won Value" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Lost Value" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Stage Breakdown + Avg Contract Value */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Opportunity Stage Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opportunities by Stage</CardTitle>
            <CardDescription>Distribution of projects across outcome stages</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : stageData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No stage data available
              </div>
            ) : (
              <div className="flex gap-4 items-center">
                <ResponsiveContainer width="55%" height={220}>
                  <PieChart>
                    <Pie
                      data={stageData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) =>
                        percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''
                      }
                      labelLine={false}
                    >
                      {stageData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color ?? STAGE_COLORS[index % STAGE_COLORS.length]} />
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
                <div className="flex-1 space-y-3">
                  {stageData.map((stage) => (
                    <div key={stage.name} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-sm shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{stage.name}</div>
                        <div className="text-xs text-muted-foreground">{stage.value} projects</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Average Contract Value Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Contract Value Trend</CardTitle>
            <CardDescription>Monthly average deal size</CardDescription>
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
                <BarChart data={avgValueTrend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatCurrency(v)} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--background))',
                    }}
                  />
                  <Bar dataKey="Avg Contract Value" radius={[3, 3, 0, 0]}>
                    {avgValueTrend.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={STAGE_COLORS[index % STAGE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
