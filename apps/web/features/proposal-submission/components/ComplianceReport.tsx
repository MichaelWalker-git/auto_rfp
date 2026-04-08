'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  FileCheck,
  FolderCheck,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useComplianceReport } from '../hooks/useComplianceReport';
import type { ComplianceCategorySummary, ComplianceCheckCategory, ReadinessCheckItem } from '@auto-rfp/core';

interface ComplianceReportProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

// ─── Category Icons ───────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<ComplianceCheckCategory, React.ReactNode> = {
  submission_readiness: <ShieldCheck className="h-4 w-4" />,
  format_compliance: <FileCheck className="h-4 w-4" />,
  document_completeness: <FolderCheck className="h-4 w-4" />,
  content_validation: <FileText className="h-4 w-4" />,
  quality_checks: <Sparkles className="h-4 w-4" />,
};

// ─── Check Row ────────────────────────────────────────────────────────────────

const CheckRow = ({ check }: { check: ReadinessCheckItem }) => {
  const icon = check.passed
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
    : check.blocking
      ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
      : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;

  return (
    <div className="flex items-start gap-2.5 py-2 px-3">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-xs font-medium leading-tight',
          check.passed ? 'text-foreground' : check.blocking ? 'text-destructive' : 'text-amber-700',
        )}>
          {check.label}
        </p>
        {check.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
        )}
      </div>
      {!check.passed && (
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] shrink-0 px-1.5 py-0',
            check.blocking
              ? 'border-destructive/30 text-destructive'
              : 'border-amber-300 text-amber-700',
          )}
        >
          {check.blocking ? 'Blocking' : 'Warning'}
        </Badge>
      )}
    </div>
  );
};

// ─── Category Section ─────────────────────────────────────────────────────────

const CategorySection = ({ category }: { category: ComplianceCategorySummary }) => {
  const [isExpanded, setIsExpanded] = useState(!category.allPassed);
  const icon = CATEGORY_ICONS[category.category];
  const progressPercent = category.totalChecks > 0
    ? Math.round((category.passed / category.totalChecks) * 100)
    : 100;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className={cn('shrink-0', category.allPassed ? 'text-emerald-500' : 'text-muted-foreground')}>
          {icon}
        </span>
        <span className="text-sm font-medium flex-1 text-left">{category.label}</span>
        <Progress
          value={progressPercent}
          className="h-1.5 w-16 shrink-0"
        />
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {category.passed}/{category.totalChecks}
        </span>
        {category.allPassed ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : (
          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 px-1.5 py-0 shrink-0">
            {category.failed}
          </Badge>
        )}
      </button>
      {isExpanded && (
        <div className="border-t bg-muted/10 divide-y divide-border/50">
          {category.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const ComplianceReport = ({ orgId, projectId, oppId }: ComplianceReportProps) => {
  const {
    report,
    isReady,
    categories,
    blockingFails,
    warningFails,
    totalChecks,
    passRate,
    isLoading,
  } = useComplianceReport(orgId, projectId, oppId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Compliance Report
          <span className="text-xs font-normal text-muted-foreground">
            {passRate}% · {totalChecks} checks
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={isReady ? 'default' : blockingFails > 0 ? 'destructive' : 'outline'}>
            {isReady
              ? 'Ready'
              : blockingFails > 0
                ? `${blockingFails} blocking`
                : `${warningFails} warning${warningFails !== 1 ? 's' : ''}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {categories.map((cat) => (
            <CategorySection key={cat.category} category={cat} />
          ))}
        </div>
        {report.generatedAt && (
          <p className="text-[10px] text-muted-foreground mt-3 text-right">
            Last checked {new Date(report.generatedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
