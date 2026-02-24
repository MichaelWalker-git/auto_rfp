'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Download } from 'lucide-react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { GenerateReportSchema, ReportTypeSchema } from '@auto-rfp/core';
import type { GenerateReport, GenerateReportResponse } from '@auto-rfp/core';
import { useAuditReport } from '../hooks/useAuditReport';

const FormSchema = z.object({
  orgId: z.string().min(1),
  reportType: ReportTypeSchema,
  format: z.enum(['json', 'csv']).default('json'),
  userId: z.string().optional(),
});

type FormValues = z.input<typeof FormSchema>;

interface AuditReportFormProps {
  orgId: string;
}

export const AuditReportForm = ({ orgId }: AuditReportFormProps) => {
  const { trigger, isMutating } = useAuditReport();
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [dateError, setDateError] = useState('');
  const [jsonResult, setJsonResult] = useState<GenerateReportResponse | null>(null);
  const [reportError, setReportError] = useState('');

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { orgId, format: 'json' },
  });

  const selectedFormat = watch('format') ?? 'json';

  const onSubmit = async (values: FormValues) => {
    if (!fromDate || !toDate) {
      setDateError('Please select both From and To dates.');
      return;
    }
    setDateError('');
    setJsonResult(null);
    setReportError('');

    try {
      const payload: GenerateReport = GenerateReportSchema.parse({
        ...values,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      });

      const result = await trigger(payload);

      if (payload.format === 'csv' && typeof result === 'string') {
        // Trigger browser download for CSV
        const blob = new Blob([result], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-report-${payload.reportType}-${format(fromDate, 'yyyy-MM-dd')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (result && typeof result === 'object') {
        // Display JSON result inline
        setJsonResult(result as GenerateReportResponse);
      }
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to generate report');
    }
  };

  const handleDownloadJson = () => {
    if (!jsonResult || !fromDate) return;
    const blob = new Blob([JSON.stringify(jsonResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-${jsonResult.reportType}-${format(fromDate, 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Compliance Reports</CardTitle>
        <CardDescription>
          Generate compliance reports for ISO 27001 and FedRAMP audits. Export as JSON or CSV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
          <input type="hidden" {...register('orgId')} />

          {/* Report Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Report type</label>
            <Select onValueChange={(v) => { setValue('reportType', v as GenerateReport['reportType']); setJsonResult(null); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                {ReportTypeSchema.options.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.reportType && (
              <p className="text-xs text-destructive">{errors.reportType.message}</p>
            )}
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !fromDate && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'MMM d, yyyy') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    disabled={(date) => (toDate ? date > toDate : false)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !toDate && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'MMM d, yyyy') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    disabled={(date) => (fromDate ? date < fromDate : false)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {dateError && <p className="text-xs text-destructive">{dateError}</p>}

          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Export format</label>
            <Select
              onValueChange={(v) => { setValue('format', v as 'json' | 'csv'); setJsonResult(null); }}
              defaultValue="json"
            >
              <SelectTrigger>
                <SelectValue placeholder="Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON (view inline)</SelectItem>
                <SelectItem value="csv">CSV (download)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reportError && <p className="text-xs text-destructive">{reportError}</p>}

          <Button type="submit" disabled={isMutating} className="w-full sm:w-auto">
            {isMutating ? 'Generating…' : 'Generate Report'}
          </Button>
        </form>

        {/* JSON Result Display */}
        {jsonResult && (
          <div className="max-w-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {jsonResult.reportType.replace(/_/g, ' ')} — {jsonResult.rowCount} rows
                </p>
                <p className="text-xs text-muted-foreground">
                  Generated at {new Date(jsonResult.generatedAt).toLocaleString()}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadJson}>
                <Download className="h-3.5 w-3.5" />
                Download JSON
              </Button>
            </div>
            <pre className="bg-muted/40 border rounded-md p-4 text-xs overflow-auto max-h-96 text-foreground">
              {JSON.stringify(jsonResult.data, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
