'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AuditActionSchema, AuditResourceSchema } from '@auto-rfp/core';
import type { AuditLogFilters as AuditLogFiltersType } from '../hooks/useAuditLogs';

interface AuditLogFiltersProps {
  orgId: string;
  onFilter: (filters: AuditLogFiltersType) => void;
}

export const AuditLogFilters = ({ orgId, onFilter }: AuditLogFiltersProps) => {
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [result, setResult] = useState('');
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();

  const toFilterValue = (v: string) => (v === 'all' ? undefined : v || undefined);

  const handleFilter = () => {
    onFilter({
      orgId,
      userId: userId || undefined,
      action: toFilterValue(action),
      resource: toFilterValue(resource),
      result: toFilterValue(result) as 'success' | 'failure' | undefined,
      fromDate: fromDate ? fromDate.toISOString() : undefined,
      toDate: toDate ? toDate.toISOString() : undefined,
    });
  };

  const handleClear = () => {
    setUserId('');
    setAction('all');
    setResource('all');
    setResult('all');
    setFromDate(undefined);
    setToDate(undefined);
    onFilter({ orgId });
  };

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* User ID */}
      <Input
        placeholder="User ID"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="w-48"
      />

      {/* Action */}
      <Select value={action} onValueChange={setAction}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Action" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          {AuditActionSchema.options.map((a) => (
            <SelectItem key={a} value={a}>{a}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Resource */}
      <Select value={resource} onValueChange={setResource}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Resource" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All resources</SelectItem>
          {AuditResourceSchema.options.map((r) => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Result */}
      <Select value={result} onValueChange={setResult}>
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Result" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All results</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failure">Failure</SelectItem>
        </SelectContent>
      </Select>

      {/* From Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-44 justify-start text-left font-normal',
              !fromDate && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {fromDate ? format(fromDate, 'MMM d, yyyy') : <span>From date</span>}
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

      {/* To Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-44 justify-start text-left font-normal',
              !toDate && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {toDate ? format(toDate, 'MMM d, yyyy') : <span>To date</span>}
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

      <Button type="button" variant="default" onClick={handleFilter}>Filter</Button>
      <Button type="button" variant="outline" onClick={handleClear}>Clear</Button>
    </div>
  );
};
