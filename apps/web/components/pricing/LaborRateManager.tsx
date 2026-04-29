'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateLaborRateSchema, type LaborRate, type UpdateLaborRate } from '@auto-rfp/core';
import { useLaborRates, useCreateLaborRate, useUpdateLaborRate, useDeleteLaborRate } from '@/lib/hooks/use-pricing';
import { useDrafts } from '@/lib/hooks/use-extraction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, DollarSign, CalendarIcon, Upload, Pencil } from 'lucide-react';
import { mutate } from 'swr';
import { ExtractionUploadDialog, ExtractionSourceBadge } from '@/components/extraction';
import { PendingDraftsSection } from './PendingDraftsSection';
import { LaborRateInfoPopover } from './LaborRateInfoPopover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { usePermission } from '@/components/permission-wrapper';
import { z } from 'zod';

interface LaborRateManagerProps {
  orgId: string;
}

const CreateFormSchema = CreateLaborRateSchema;
type CreateFormData = z.input<typeof CreateFormSchema>;

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
  const { trigger: updateRate, isMutating: isUpdating } = useUpdateLaborRate();
  const { trigger: deleteRate } = useDeleteLaborRate(orgId);
  const { drafts: laborRateDrafts, refresh: refreshDrafts } = useDrafts<'LABOR_RATE'>(orgId, { draftType: 'LABOR_RATE', status: 'DRAFT' });
  
  const [showForm, setShowForm] = useState(false);
  const [editingRate, setEditingRate] = useState<LaborRate | null>(null);
  const { toast } = useToast();
  const canCreate = usePermission('pricing:create');
  const canDelete = usePermission('pricing:delete');

  const laborRates = data?.laborRates ?? [];

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(CreateFormSchema),
    defaultValues: { orgId, isActive: true, effectiveDate: new Date().toISOString() },
  });

  const editForm = useForm<UpdateLaborRate>();

  const onCreateSubmit = async (formData: CreateFormData) => {
    try {
      await createRate({ ...formData, orgId } as z.infer<typeof CreateLaborRateSchema>);
      toast({ title: 'Success', description: 'Labor rate created successfully' });
      createForm.reset();
      setShowForm(false);
      mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates'));
    } catch (err) {
      toast({ title: 'Error', description: parseErrorMessage(err), variant: 'destructive' });
    }
  };

  const onEditSubmit = async (formData: UpdateLaborRate) => {
    if (!editingRate) return;
    try {
      await updateRate(formData);
      toast({ title: 'Success', description: 'Labor rate updated successfully' });
      setEditingRate(null);
      editForm.reset();
      mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates'));
    } catch (err) {
      toast({ title: 'Error', description: parseErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleEdit = (rate: LaborRate) => {
    setEditingRate(rate);
    editForm.reset({
      laborRateId: rate.laborRateId, orgId, position: rate.position,
      baseRate: rate.baseRate, overhead: rate.overhead, ga: rate.ga, profit: rate.profit,
      effectiveDate: rate.effectiveDate, expirationDate: rate.expirationDate,
      isActive: rate.isActive, rateJustification: rate.rateJustification,
    });
  };

  const handleDelete = async (laborRateId: string) => {
    if (!confirm('Are you sure you want to delete this labor rate?')) return;
    try {
      await deleteRate({ laborRateId });
      toast({ title: 'Success', description: 'Labor rate deleted' });
      mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates'));
    } catch (err) {
      toast({ title: 'Error', description: parseErrorMessage(err), variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Labor Rate Table</h2>
          <div className="flex items-center gap-1">
            <p className="text-sm text-muted-foreground">Define fully loaded hourly rates by position. These rates are used to calculate costs in proposals and executive briefs.</p>
            <LaborRateInfoPopover />
          </div>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <ExtractionUploadDialog orgId={orgId} targetType="LABOR_RATE"
              onExtractionComplete={() => { mutate((key: string) => typeof key === 'string' && key.includes('/labor-rates')); refreshDrafts(); }}
              trigger={<Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1" />Upload Rate Card</Button>} />
            <Button onClick={() => setShowForm(!showForm)} size="sm"><Plus className="h-4 w-4 mr-1" />Add Rate</Button>
          </div>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Labor Rate</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">Position Title</label>
                <Input {...createForm.register('position')} placeholder="e.g., Senior Engineer" />
                {createForm.formState.errors.position && <p className="text-xs text-red-500 mt-1">{createForm.formState.errors.position.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Base Rate ($/hr)</label>
                <Input {...createForm.register('baseRate', { valueAsNumber: true })} type="number" step="0.01" placeholder="75.00" />
              </div>
              <div>
                <div className="flex items-center gap-1"><label className="text-sm font-medium">Overhead (%)</label><LaborRateInfoPopover /></div>
                <Input {...createForm.register('overhead', { valueAsNumber: true })} type="number" step="0.1" placeholder="120" />
              </div>
              <div>
                <div className="flex items-center gap-1"><label className="text-sm font-medium">G&A (%)</label><LaborRateInfoPopover /></div>
                <Input {...createForm.register('ga', { valueAsNumber: true })} type="number" step="0.1" placeholder="12" />
              </div>
              <div>
                <div className="flex items-center gap-1"><label className="text-sm font-medium">Profit (%)</label><LaborRateInfoPopover /></div>
                <Input {...createForm.register('profit', { valueAsNumber: true })} type="number" step="0.1" placeholder="10" />
              </div>
              <div>
                <label className="text-sm font-medium">Effective Date</label>
                <Controller control={createForm.control} name="effectiveDate" render={({ field }) => {
                  const selectedDate = field.value ? new Date(field.value) : undefined;
                  return (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />{selectedDate ? format(selectedDate, 'PPP') : 'Pick a date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && field.onChange(date.toISOString())} initialFocus />
                      </PopoverContent>
                    </Popover>
                  );
                }} />
              </div>
              <div>
                <label className="text-sm font-medium">Rate Justification</label>
                <Input {...createForm.register('rateJustification')} placeholder="GSA Schedule, market research..." />
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={isCreating}>{isCreating ? 'Creating...' : 'Create Rate'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Pending Drafts - using shared component with DraftReviewCard */}
      {laborRateDrafts && laborRateDrafts.length > 0 && (
        <PendingDraftsSection
          orgId={orgId}
          drafts={laborRateDrafts}
          title="Pending Draft Labor Rates"
          description="Review extracted labor rates before adding them to your rate table."
          mutateKey="/labor-rates"
          onRefresh={() => refreshDrafts()}
        />
      )}

      {laborRates.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12">
          <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No labor rates defined yet.</p>
          <p className="text-sm text-muted-foreground">Add your first labor rate to get started.</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Position</th>
                <th className="text-right p-3 font-medium">Base Rate</th>
                <th className="text-right p-3 font-medium"><div className="flex items-center justify-end gap-0.5">Overhead<LaborRateInfoPopover /></div></th>
                <th className="text-right p-3 font-medium"><div className="flex items-center justify-end gap-0.5">G&A<LaborRateInfoPopover /></div></th>
                <th className="text-right p-3 font-medium"><div className="flex items-center justify-end gap-0.5">Profit<LaborRateInfoPopover /></div></th>
                <th className="text-right p-3 font-medium"><div className="flex items-center justify-end gap-0.5">Fully Loaded<LaborRateInfoPopover /></div></th>
                <th className="text-center p-3 font-medium">Status</th>
                {canDelete && <th className="text-right p-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {laborRates.map((rate) => (
                <tr key={rate.laborRateId} className="border-t hover:bg-muted/25">
                  <td className="p-3 font-medium">
                    <div className="flex items-center gap-2">
                      {rate.position}
                      <ExtractionSourceBadge extractionSource={rate.extractionSource} />
                    </div>
                  </td>
                  <td className="p-3 text-right">${rate.baseRate.toFixed(2)}</td>
                  <td className="p-3 text-right">{rate.overhead}%</td>
                  <td className="p-3 text-right">{rate.ga}%</td>
                  <td className="p-3 text-right">{rate.profit}%</td>
                  <td className="p-3 text-right font-semibold text-primary">${rate.fullyLoadedRate.toFixed(2)}</td>
                  <td className="p-3 text-center"><Badge variant={rate.isActive ? 'default' : 'secondary'}>{rate.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  {canDelete && (
                    <td className="p-3 text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(rate)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(rate.laborRateId)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Existing Rate Dialog */}
      <Dialog open={!!editingRate} onOpenChange={(open) => !open && setEditingRate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Labor Rate</DialogTitle></DialogHeader>
          {editingRate?.extractionSource && (
            <div className="mb-4 p-3 bg-muted rounded-lg">
              <ExtractionSourceBadge extractionSource={editingRate.extractionSource} compact={false} />
            </div>
          )}
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div><label className="text-sm font-medium">Position Title</label><Input {...editForm.register('position')} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">Base Rate ($/hr)</label><Input {...editForm.register('baseRate', { valueAsNumber: true })} type="number" step="0.01" /></div>
              <div><div className="flex items-center gap-1"><label className="text-sm font-medium">Overhead (%)</label><LaborRateInfoPopover /></div><Input {...editForm.register('overhead', { valueAsNumber: true })} type="number" step="0.1" /></div>
              <div><div className="flex items-center gap-1"><label className="text-sm font-medium">G&A (%)</label><LaborRateInfoPopover /></div><Input {...editForm.register('ga', { valueAsNumber: true })} type="number" step="0.1" /></div>
              <div><div className="flex items-center gap-1"><label className="text-sm font-medium">Profit (%)</label><LaborRateInfoPopover /></div><Input {...editForm.register('profit', { valueAsNumber: true })} type="number" step="0.1" /></div>
            </div>
            <div><label className="text-sm font-medium">Rate Justification</label><Input {...editForm.register('rateJustification')} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingRate(null)}>Cancel</Button><Button type="submit" disabled={isUpdating}>{isUpdating ? 'Saving...' : 'Save Changes'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
