'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Award, Clock, DollarSign, Download, FileText,
  RefreshCw, Target, TrendingUp, Zap,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { useCurrentOrganization } from '@/context/organization-context';
import { useAnalytics } from '@/lib/hooks/use-analytics';
import { formatMonth, LOSS_REASON_LABELS } from '@auto-rfp/core';
import type { MonthlyAnalytics } from '@auto-rfp/core';
import { DateRangeFilter, exportToCsv, exportToPdf } from '@/features/dashboard';
import { cn } from '@/lib/utils';

// ─── Helpers ───

const fmt$ = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};

const fmtMo = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const TT = {
  fontSize: 12, borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--background))',
};

const PIE_COLORS = ['#10b981', '#ef4444', '#94a3b8', '#6366f1'];

const accentMap = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', icon: 'text-emerald-600', value: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-900' },
  indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-950/30',   icon: 'text-indigo-600',  value: 'text-indigo-700 dark:text-indigo-400',   border: 'border-indigo-100 dark:border-indigo-900' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/30',     icon: 'text-amber-600',   value: 'text-amber-700 dark:text-amber-400',     border: 'border-amber-100 dark:border-amber-900' },
  red:     { bg: 'bg-red-50 dark:bg-red-950/30',         icon: 'text-red-600',     value: 'text-red-700 dark:text-red-400',         border: 'border-red-100 dark:border-red-900' },
  default: { bg: 'bg-muted/40', icon: 'text-muted-foreground', value: 'text-foreground', border: 'border-border' },
};

type Accent = keyof typeof accentMap;

const KpiCard = ({ title, value, sub, icon: Icon, accent = 'default', isLoading }: {
  title: string; value: string; sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent; isLoading?: boolean;
}) => {
  const c = accentMap[accent];
  if (isLoading) return (
    <Card className="border">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
  return (
    <Card className={cn('border transition-shadow hover:shadow-md', c.border)}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{title}</p>
            <p className={cn('text-2xl font-bold mt-1 leading-none', c.value)}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{sub}</p>
          </div>
          <div className={cn('p-2.5 rounded-lg shrink-0', c.bg)}>
            <Icon className={cn('h-5 w-5', c.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const getDefaultRange = () => {
  const now = new Date();
  return {
    start: formatMonth(new Date(now.getFullYear(), now.getMonth() - 5, 1)),
    end: formatMonth(now),
  };
};

// ─── Main Component ───

interface Props { orgId: string }

export const OrgDashboardClient = ({ orgId }: Props) => {
  const { currentOrganization } = useCurrentOrganization();
  const orgName = currentOrganization?.name ?? 'Organization';

  const defaults = getDefaultRange();
  const [startMonth, setStartMonth] = useState(defaults.start);
  const [endMonth, setEndMonth] = useState(defaults.end);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, mutate } = useAnalytics(orgId, startMonth, endMonth);
  const summary = data?.summary;
  const analytics = data?.analytics ?? [];
  const noData = !isLoading && analytics.length === 0;

  const handleRefresh = useCallback(() => mutate(), [mutate]);
  const handleExportCsv = useCallback(async () => {
    if (!data) return;
    setIsExporting(true);
    try { exportToCsv(data, orgName); } finally { setIsExporting(false); }
  }, [data, orgName]);
  const handleExportPdf = useCallback(async () => {
    if (!data) return;
    setIsExporting(true);
    try { await exportToPdf(data, orgName); } finally { setIsExporting(false); }
  }, [data, orgName]);

  const winLossData = useMemo(() => analytics.map((m: MonthlyAnalytics) => ({
    month: fmtMo(m.month), Won: m.projectsWon, Lost: m.projectsLost, 'No Bid': m.projectsNoBid,
  })), [analytics]);

  const winRateData = useMemo(() => analytics.map((m: MonthlyAnalytics) => ({
    month: fmtMo(m.month), 'Win Rate': Number(m.winRate.toFixed(1)),
  })), [analytics]);

  const pipelineData = useMemo(() => analytics.map((m: MonthlyAnalytics) => ({
    month: fmtMo(m.month), Pipeline: Math.round(m.totalPipelineValue), 'Won Value': Math.round(m.totalWonValue),
  })), [analytics]);

  const stageData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Won', value: summary.totalWon },
      { name: 'Lost', value: summary.totalLost },
      { name: 'No Bid', value: summary.totalNoBid },
      { name: 'Active', value: Math.max(0, summary.totalProjects - summary.totalWon - summary.totalLost - summary.totalNoBid) },
    ].filter(s => s.value > 0);
  }, [summary]);

  const lossReasons = useMemo(() => {
    if (!summary?.lossReasonCounts) return [];
    return Object.entries(summary.lossReasonCounts)
      .filter(([, c]) => c > 0).sort(([, a], [, b]) => b - a).slice(0, 5)
      .map(([r, c]) => ({ label: LOSS_REASON_LABELS[r as keyof typeof LOSS_REASON_LABELS] ?? r, count: c }));
  }, [summary]);

  const roi = useMemo(() => {
    const submitted = summary?.totalSubmitted ?? 0;
    const months = summary?.monthCount ?? 1;
    const hoursSaved = submitted * 28;
    const laborSaved = hoursSaved * 85;
    const platformCost = months * 500;
    return { totalSubmitted: submitted, hoursSaved, laborSaved, platformCost, net: laborSaved - platformCost, wonValue: summary?.totalWonValue ?? 0 };
  }, [summary]);

  const winRate = summary?.winRate ?? 0;

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Analytics Dashboard"
        description="Organisation-wide proposal performance and business intelligence"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!data || isExporting}>
                  <Download className="h-4 w-4 mr-1.5" />Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCsv}>Export as CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf}>Export as PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Date Range Filter */}
        <DateRangeFilter
          startMonth={startMonth}
          endMonth={endMonth}
          onStartMonthChange={setStartMonth}
          onEndMonthChange={setEndMonth}
        />

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Win Rate" value={`${winRate.toFixed(1)}%`} sub={`${summary?.totalWon ?? 0} won · ${summary?.totalLost ?? 0} lost`} icon={Award} accent={winRate >= 50 ? 'emerald' : winRate >= 30 ? 'amber' : 'red'} isLoading={isLoading} />
          <KpiCard title="Pipeline Value" value={fmt$(summary?.totalPipelineValue ?? 0)} sub={`${summary?.totalProjects ?? 0} projects tracked`} icon={DollarSign} accent="indigo" isLoading={isLoading} />
          <KpiCard title="Won Contract Value" value={fmt$(summary?.totalWonValue ?? 0)} sub={`Avg ${fmt$(summary?.averageContractValue ?? 0)} per deal`} icon={TrendingUp} accent="emerald" isLoading={isLoading} />
          <KpiCard title="Submission Rate" value={`${(summary?.submissionRate ?? 0).toFixed(1)}%`} sub={`${summary?.totalSubmitted ?? 0} bids submitted`} icon={FileText} accent="default" isLoading={isLoading} />
        </div>

        {/* Charts Row 1 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Win / Loss by Month</CardTitle>
              <CardDescription>Monthly outcome breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-56 w-full" /> : noData ? (
                <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <BarChart data={winLossData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TT} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="Won" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Lost" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="No Bid" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Win Rate Trend</CardTitle>
              <CardDescription>Monthly win rate over time</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-56 w-full" /> : noData ? (
                <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <AreaChart data={winRateData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="wrG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip formatter={(v: number) => [`${v}%`, 'Win Rate']} contentStyle={TT} />
                    <Area type="monotone" dataKey="Win Rate" stroke="#10b981" strokeWidth={2.5} fill="url(#wrG)" dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline vs Won Value</CardTitle>
              <CardDescription>Monthly contract value trends</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-56 w-full" /> : noData ? (
                <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <LineChart data={pipelineData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={fmt$} width={52} />
                    <Tooltip formatter={(v: number) => fmt$(v)} contentStyle={TT} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Line type="monotone" dataKey="Pipeline" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="Won Value" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Opportunities by Stage</CardTitle>
              <CardDescription>Distribution across outcome stages</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-56 w-full" /> : stageData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={200}>
                    <PieChart>
                      <Pie data={stageData} cx="50%" cy="50%" outerRadius={82} innerRadius={36} paddingAngle={3} dataKey="value"
                        label={({ percent }) => percent > 0.06 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                        {stageData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TT} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2.5">
                    {stageData.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-xs text-muted-foreground flex-1 truncate">{s.name}</span>
                        <span className="text-xs font-semibold tabular-nums">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Insights Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Loss Reasons</CardTitle>
              <CardDescription>Why proposals were not won</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : lossReasons.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No loss data available</div>
              ) : (
                <div className="space-y-3">
                  {lossReasons.map((r) => {
                    const total = lossReasons.reduce((s, x) => s + x.count, 0);
                    const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
                    return (
                      <div key={r.label} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-muted-foreground truncate flex-1">{r.label}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-sm font-semibold tabular-nums">{r.count}</span>
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">{pct}%</Badge>
                          </div>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-destructive/70 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ROI Estimate</CardTitle>
              <CardDescription>Platform value vs manual process (40 hrs/bid → 12 hrs)</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <div>
                  {[
                    { label: 'Bids Submitted', value: String(roi.totalSubmitted), icon: Target, color: '' },
                    { label: 'Hours Saved', value: `${roi.hoursSaved.toLocaleString()} hrs`, icon: Clock, color: 'text-indigo-600 dark:text-indigo-400' },
                    { label: 'Labor Cost Saved', value: fmt$(roi.laborSaved), icon: DollarSign, color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Platform Cost', value: fmt$(roi.platformCost), icon: Zap, color: 'text-muted-foreground' },
                    { label: 'Net Savings', value: fmt$(roi.net), icon: TrendingUp, color: roi.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive' },
                    { label: 'Won Contract Value', value: fmt$(roi.wonValue), icon: Award, color: 'text-emerald-600 dark:text-emerald-400' },
                  ].map((row, i, arr) => (
                    <div key={row.label}>
                      <div className="flex items-center justify-between py-2.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <row.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm text-muted-foreground truncate">{row.label}</span>
                        </div>
                        <span className={`text-sm font-semibold tabular-nums shrink-0 ${row.color}`}>{row.value}</span>
                      </div>
                      {i < arr.length - 1 && <Separator />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Period Summary */}
        {!isLoading && !noData && summary && (
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Period Summary · {summary.periodStart} → {summary.periodEnd} ({summary.monthCount} months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">{summary.totalWon} Won</Badge>
                <Badge variant="destructive">{summary.totalLost} Lost</Badge>
                <Badge variant="secondary">{summary.totalNoBid} No Bid</Badge>
                <Badge variant="outline">{summary.totalSubmitted} Submitted</Badge>
                <Badge variant="outline">{summary.totalProjects} Total Projects</Badge>
                <Badge variant="outline">Avg {fmt$(summary.averageContractValue)} / deal</Badge>
                {summary.topLossReason && (
                  <Badge variant="outline" className="border-destructive/50 text-destructive">
                    Top Loss: {summary.topLossReason.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
