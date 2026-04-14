'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateLaborRateSchema, type CreateLaborRate } from '@auto-rfp/core';
import { useLaborRates, useCreateLaborRate, useDeleteLaborRate } from '@/lib/hooks/use-pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, DollarSign, CalendarIcon } from 'lucide-react';
import { mutate } from 'swr';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { usePermission } from '@/components/permission-wrapper';

interface LaborRateManagerProps {
  orgId: string;
}

const parseErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed?.message || err.message;
    } catch {
      return err.message;
    }
  }
  return 'An unexpected error occurred';
};

export const LaborRateManager = ({ orgId }: LaborRateManagerProps) => {
  const { data, isLoading } = useLaborRates(orgId);
  const { trigger: createRate, isMutating: isCreating } = useCreateLaborRate(orgId);
  const { trigger: deleteRate } = useDeleteLaborRate(orgId);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const canCreate = usePermission('pricing:create');
  const canDelete = usePermission('pricing:delete');

  const laborRates = data?.laborRates ?? [];

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<CreateLaborRate>({
    resolver: zodResolver(CreateLaborRateSchema),
    defaultValues: {
      orgId,
      isActive: true,
      effectiveDate: new Date().toISOString(),
    },
  });

  const onSubmit = async (formData: CreateLaborRate) => {
    try {
      await createRate({ ...formData, orgId });
      toast({ title: 'Success', description: 'Labor rate created successfully' });
      reset();
      setShowForm(false);
      mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates'));
    } catch (err) {
      const message = parseErrorMessage(err);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleDelete = async (laborRateId: string) => {
    if (!confirm('Are you sure you want to delete this labor rate?')) return;
    try {
      await deleteRate({ laborRateId });
      toast({ title: 'Success', description: 'Labor rate deleted' });
      mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates'));
    } catch (err) {
      const message = parseErrorMessage(err);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Labor Rate Table</h2>
          <p className="text-sm text-muted-foreground">
            Define hourly rates with overhead, G&A, and profit margins for each position.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(!showForm)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Rate
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Labor Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">Position Title</label>
                <Input {...register('position')} placeholder="e.g., Senior Engineer" />
                {errors.position && <p className="text-xs text-red-500 mt-1">{errors.position.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Base Rate ($/hr)</label>
                <Input {...register('baseRate', { valueAsNumber: true })} type="number" step="0.01" placeholder="75.00" />
                {errors.baseRate && <p className="text-xs text-red-500 mt-1">{errors.baseRate.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Overhead (%)</label>
                <Input {...register('overhead', { valueAsNumber: true })} type="number" step="0.1" placeholder="120" />
                {errors.overhead && <p className="text-xs text-red-500 mt-1">{errors.overhead.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">G&A (%)</label>
                <Input {...register('ga', { valueAsNumber: true })} type="number" step="0.1" placeholder="12" />
                {errors.ga && <p className="text-xs text-red-500 mt-1">{errors.ga.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Profit (%)</label>
                <Input {...register('profit', { valueAsNumber: true })} type="number" step="0.1" placeholder="10" />
                {errors.profit && <p className="text-xs text-red-500 mt-1">{errors.profit.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Effective Date</label>
                <Controller
                  control={control}
                  name="effectiveDate"
                  render={({ field }) => {
                    const selectedDate = field.value ? new Date(field.value) : undefined;
                    return (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal',
                              !field.value && 'text-muted-foreground',
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {selectedDate ? format(selectedDate, 'PPP') : 'Pick a date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => {
                              if (date) {
                                field.onChange(date.toISOString());
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    );
                  }}
                />
                {errors.effectiveDate && <p className="text-xs text-red-500 mt-1">{errors.effectiveDate.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Rate Justification</label>
                <Input {...register('rateJustification')} placeholder="GSA Schedule, market research..." />
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? 'Creating...' : 'Create Rate'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {laborRates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No labor rates defined yet.</p>
            <p className="text-sm text-muted-foreground">Add your first labor rate to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Position</th>
                <th className="text-right p-3 font-medium">Base Rate</th>
                <th className="text-right p-3 font-medium">Overhead</th>
                <th className="text-right p-3 font-medium">G&A</th>
                <th className="text-right p-3 font-medium">Profit</th>
                <th className="text-right p-3 font-medium">Fully Loaded</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {laborRates.map((rate) => (
                <tr key={rate.laborRateId} className="border-t hover:bg-muted/25">
                  <td className="p-3 font-medium">{rate.position}</td>
                  <td className="p-3 text-right">${rate.baseRate.toFixed(2)}</td>
                  <td className="p-3 text-right">{rate.overhead}%</td>
                  <td className="p-3 text-right">{rate.ga}%</td>
                  <td className="p-3 text-right">{rate.profit}%</td>
                  <td className="p-3 text-right font-semibold text-primary">${rate.fullyLoadedRate.toFixed(2)}</td>
                  <td className="p-3 text-center">
                    <Badge variant={rate.isActive ? 'default' : 'secondary'}>
                      {rate.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {canDelete && (
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(rate.laborRateId)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
