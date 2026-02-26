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
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Clock, DollarSign, Percent, Zap } from 'lucide-react';
import { KpiCard } from './kpi-card';
import type { GetAnalyticsResponse, MonthlyAnalytics } from '@auto-rfp/core';

interface RoiTrackingProps {
  data: GetAnalyticsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Estimated hours saved per RFP vs manual process */
  hoursPerRfpManual?: number;
  /** Estimated hourly rate for proposal staff ($/hr) */
  hourlyRate?: number;
  /** Monthly platform cost ($) */
  platformMonthlyCost?: number;
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

// Default assumptions for ROI calculation
const DEFAULT_HOURS_MANUAL = 40; // hours per RFP manually
const DEFAULT_HOURS_PLATFORM = 12; // hours per RFP with platform
const DEFAULT_HOURLY_RATE = 85; // $/hr for proposal staff
const DEFAULT_PLATFORM_MONTHLY = 500; // $/month platform cost

export const RoiTracking = ({
  data,
  isLoading,
  isError,
  hoursPerRfpManual = DEFAULT_HOURS_MANUAL,
  hourlyRate = DEFAULT_HOURLY_RATE,
  platformMonthlyCost = DEFAULT_PLATFORM_MONTHLY,
}: RoiTrackingProps) => {
  const analytics = data?.analytics ?? [];
  const summary = data?.summary;

  const hoursSavedPerRfp = hoursPerRfpManual - DEFAULT_HOURS_PLATFORM;

  // ROI calculations
  const roiMetrics = useMemo(() => {
    if (!summary) {
      return {
        totalHoursSaved: 0,
        totalLaborSaved: 0,
        totalPlatformCost: 0,
        netSavings: 0,
        roi: 0,
        costPerBid: 0,
        revenuePerDollarSpent: 0,
      };
    }

    const totalSubmitted = summary.totalSubmitted;
    const monthCount = summary.monthCount;

    const totalHoursSaved = totalSubmitted * hoursSavedPerRfp;
    const totalLaborSaved = totalHoursSaved * hourlyRate;
    const totalPlatformCost = platformMonthlyCost * monthCount;
    const netSavings = totalLaborSaved - totalPlatformCost;
    const roi = totalPlatformCost > 0 ? ((netSavings / totalPlatformCost) * 100) : 0;
    const costPerBid = totalSubmitted > 0
      ? (totalPlatformCost + totalSubmitted * DEFAULT_HOURS_PLATFORM * hourlyRate) / totalSubmitted
      : 0;
    const revenuePerDollarSpent = totalPlatformCost > 0
      ? summary.totalWonValue / totalPlatformCost
      : 0;

    return {
      totalHoursSaved,
      totalLaborSaved,
      totalPlatformCost,
      netSavings,
      roi,
      costPerBid,
      revenuePerDollarSpent,
    };
  }, [summary, hoursSavedPerRfp, hourlyRate, platformMonthlyCost]);

  // Monthly ROI trend
  const roiTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => {
        const hoursSaved = m.projectsSubmitted * hoursSavedPerRfp;
        const laborSaved = hoursSaved * hourlyRate;
        const platformCost = platformMonthlyCost;
        const netSavings = laborSaved - platformCost;
        return {
          month: formatMonth(m.month),
          'Labor Saved': Math.round(laborSaved),
          'Platform Cost': Math.round(platformCost),
          'Net Savings': Math.round(netSavings),
        };
      }),
    [analytics, hoursSavedPerRfp, hourlyRate, platformMonthlyCost],
  );

  // Hours saved trend
  const hoursTrend = useMemo(
    () =>
      analytics.map((m: MonthlyAnalytics) => ({
        month: formatMonth(m.month),
        'Hours Saved': m.projectsSubmitted * hoursSavedPerRfp,
        'Bids Submitted': m.projectsSubmitted,
      })),
    [analytics, hoursSavedPerRfp],
  );

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load ROI data. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const noData = !isLoading && analytics.length === 0;

  return (
    <div className="space-y-6">
      {/* ROI KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Hours Saved"
          value={isLoading ? '—' : `${roiMetrics.totalHoursSaved.toLocaleString()} hrs`}
          description={`${hoursSavedPerRfp} hrs saved per bid`}
          icon={Clock}
          isLoading={isLoading}
          valueClassName="text-indigo-600"
        />
        <KpiCard
          title="Labor Cost Saved"
          value={isLoading ? '—' : formatCurrency(roiMetrics.totalLaborSaved)}
          description={`at $${hourlyRate}/hr`}
          icon={DollarSign}
          isLoading={isLoading}
          valueClassName="text-emerald-600"
        />
        <KpiCard
          title="Platform ROI"
          value={isLoading ? '—' : `${roiMetrics.roi.toFixed(0)}%`}
          description={`net savings: ${formatCurrency(roiMetrics.netSavings)}`}
          icon={Percent}
          isLoading={isLoading}
          valueClassName={roiMetrics.roi >= 0 ? 'text-emerald-600' : 'text-destructive'}
        />
        <KpiCard
          title="Revenue per $ Spent"
          value={isLoading ? '—' : `${roiMetrics.revenuePerDollarSpent.toFixed(1)}x`}
          description="won value / platform cost"
          icon={Zap}
          isLoading={isLoading}
          valueClassName="text-amber-600"
        />
      </div>

      {/* ROI Assumptions Card */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">ROI Calculation Assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-0.5">Manual hours / RFP</div>
              <div className="font-semibold">{hoursPerRfpManual} hrs</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-0.5">Platform hours / RFP</div>
              <div className="font-semibold">{DEFAULT_HOURS_PLATFORM} hrs</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-0.5">Staff hourly rate</div>
              <div className="font-semibold">${hourlyRate}/hr</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-0.5">Platform cost / month</div>
              <div className="font-semibold">${platformMonthlyCost}/mo</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly ROI Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly ROI Breakdown</CardTitle>
          <CardDescription>Labor savings vs platform cost and net savings per month</CardDescription>
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
              <BarChart data={roiTrend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
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
                <Bar dataKey="Labor Saved" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Platform Cost" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Net Savings" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Hours Saved + Cost Per Bid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hours Saved Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours Saved per Month</CardTitle>
            <CardDescription>Time saved vs manual process by month</CardDescription>
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
                <LineChart data={hoursTrend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
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
                    dataKey="Hours Saved"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Bids Submitted"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ROI Summary Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ROI Summary</CardTitle>
            <CardDescription>Full-period return on investment breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-0">
                {[
                  { label: 'Total Bids Submitted', value: `${summary?.totalSubmitted ?? 0}` },
                  { label: 'Hours Saved (total)', value: `${roiMetrics.totalHoursSaved.toLocaleString()} hrs` },
                  { label: 'Labor Cost Saved', value: formatCurrency(roiMetrics.totalLaborSaved), highlight: 'emerald' },
                  { label: 'Total Platform Cost', value: formatCurrency(roiMetrics.totalPlatformCost), highlight: 'red' },
                  { label: 'Net Savings', value: formatCurrency(roiMetrics.netSavings), highlight: roiMetrics.netSavings >= 0 ? 'emerald' : 'red' },
                  { label: 'Cost per Bid', value: formatCurrency(roiMetrics.costPerBid) },
                  { label: 'Won Contract Value', value: formatCurrency(summary?.totalWonValue ?? 0), highlight: 'emerald' },
                  { label: 'Revenue per $ Spent', value: `${roiMetrics.revenuePerDollarSpent.toFixed(1)}x`, highlight: 'amber' },
                ].map((row, i, arr) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between py-2.5">
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <span
                        className={`text-sm font-semibold ${
                          row.highlight === 'emerald'
                            ? 'text-emerald-600'
                            : row.highlight === 'red'
                              ? 'text-destructive'
                              : row.highlight === 'amber'
                                ? 'text-amber-600'
                                : ''
                        }`}
                      >
                        {row.value}
                      </span>
                    </div>
                    {i < arr.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
