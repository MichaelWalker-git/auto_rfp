'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateBOMItemSchema, BOMItemTypeSchema } from '@auto-rfp/core';
import { z } from 'zod';
import { useBOMItems, useCreateBOMItem, useDeleteBOMItem } from '@/lib/hooks/use-pricing';
import { useDrafts } from '@/lib/hooks/use-extraction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, Package, Upload } from 'lucide-react';
import { mutate } from 'swr';
import { usePermission } from '@/components/permission-wrapper';
import { ExtractionUploadDialog, ExtractionSourceBadge, type AnyDraft } from '@/components/extraction';
import { PendingDraftsSection } from './PendingDraftsSection';
import { cn } from '@/lib/utils';

const BOM_CATEGORIES = BOMItemTypeSchema.options;

const categoryLabels: Record<string, string> = {
  HARDWARE: 'Hardware',
  SOFTWARE_LICENSE: 'Software License',
  MATERIALS: 'Materials',
  SUBCONTRACTOR: 'Subcontractor',
  TRAVEL: 'Travel',
  ODC: 'Other Direct Costs',
};

const categoryColors: Record<string, string> = {
  HARDWARE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400',
  SOFTWARE_LICENSE: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-400',
  MATERIALS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400',
  SUBCONTRACTOR: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400',
  TRAVEL: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-400',
  ODC: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

type BOMFormData = z.input<typeof CreateBOMItemSchema>;

interface BOMCalculatorProps {
  orgId: string;
}

export const BOMCalculator = ({ orgId }: BOMCalculatorProps) => {
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const { data, isLoading } = useBOMItems(orgId, filterCategory);
  const { trigger: createItem, isMutating: isCreating } = useCreateBOMItem(orgId);
  const { trigger: deleteItem } = useDeleteBOMItem(orgId);
  const { drafts: bomDrafts, refresh: refreshDrafts } = useDrafts<'BOM_ITEM'>(orgId, { draftType: 'BOM_ITEM', status: 'DRAFT' });
  
  const [showForm, setShowForm] = useState(false);
  const canCreate = usePermission('pricing:create');
  const canDelete = usePermission('pricing:delete');

  const bomItems = data?.bomItems ?? [];

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<BOMFormData>({
    resolver: zodResolver(CreateBOMItemSchema),
    defaultValues: { orgId, isActive: true, category: 'HARDWARE' },
  });

  const onSubmit = async (formData: BOMFormData) => {
    try {
      const validated = CreateBOMItemSchema.parse({ ...formData, orgId });
      await createItem(validated);
      reset();
      setShowForm(false);
      mutate((key: string) => typeof key === 'string' && key.includes('/bom-items'));
    } catch (err) {
      console.error('Failed to create BOM item:', err);
    }
  };

  const handleDelete = async (bomItemId: string) => {
    if (!confirm('Are you sure you want to delete this BOM item?')) return;
    try {
      await deleteItem({ bomItemId });
      mutate((key: string) => typeof key === 'string' && key.includes('/bom-items'));
    } catch (err) {
      console.error('Failed to delete BOM item:', err);
    }
  };

  const totalCost = bomItems.reduce((sum, item) => sum + item.unitCost, 0);

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Bill of Materials</h2>
          <p className="text-sm text-muted-foreground">Track hardware, software, materials, and other direct costs.</p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <ExtractionUploadDialog orgId={orgId} targetType="BOM_ITEM"
              onExtractionComplete={() => { mutate((key: string) => typeof key === 'string' && key.includes('/bom-items')); refreshDrafts(); }}
              trigger={<Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1" />Upload Quote</Button>} />
            <Button onClick={() => setShowForm(!showForm)} size="sm"><Plus className="h-4 w-4 mr-1" />Add Item</Button>
          </div>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap items-center">
        <Button variant={!filterCategory ? 'default' : 'outline'} size="sm" onClick={() => setFilterCategory(undefined)}>All</Button>
        {BOM_CATEGORIES.map((cat) => (
          <Button key={cat} variant={filterCategory === cat ? 'default' : 'outline'} size="sm" onClick={() => setFilterCategory(cat)}>
            {categoryLabels[cat]}
          </Button>
        ))}
      </div>

      {/* Pending Drafts - using shared component with DraftReviewCard */}
      {bomDrafts && bomDrafts.length > 0 && (
        <PendingDraftsSection
          orgId={orgId}
          drafts={bomDrafts}
          title="Pending Draft BOM Items"
          description="Review extracted BOM items before adding them to your inventory."
          mutateKey="/bom-items"
          onRefresh={refreshDrafts}
        />
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New BOM Item</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">Item Name</label>
                <Input {...register('name')} placeholder="e.g., Dell PowerEdge R750" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {BOM_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{categoryLabels[cat]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Unit Cost ($)</label>
                <Input {...register('unitCost', { valueAsNumber: true })} type="number" step="0.01" placeholder="1500.00" />
                {errors.unitCost && <p className="text-xs text-red-500 mt-1">{errors.unitCost.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Unit</label>
                <Input {...register('unit')} placeholder="each, license, month..." />
                {errors.unit && <p className="text-xs text-red-500 mt-1">{errors.unit.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Vendor</label>
                <Input {...register('vendor')} placeholder="Dell, Microsoft..." />
              </div>
              <div>
                <label className="text-sm font-medium">Part Number</label>
                <Input {...register('partNumber')} placeholder="Optional" />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium">Description</label>
                <Input {...register('description')} placeholder="Optional description" />
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={isCreating}>{isCreating ? 'Creating...' : 'Add Item'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {bomItems.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12">
          <Package className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No BOM items yet.</p>
          <p className="text-sm text-muted-foreground">Add hardware, software, and other cost items.</p>
        </CardContent></Card>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">Unit Cost</th>
                  <th className="text-left p-3 font-medium">Unit</th>
                  <th className="text-left p-3 font-medium">Vendor</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bomItems.map((item) => (
                  <tr key={item.bomItemId} className="border-t hover:bg-muted/25">
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-2">
                        {item.name}
                        <ExtractionSourceBadge extractionSource={item.extractionSource} />
                      </div>
                    </td>
                    <td className="p-3"><Badge className={categoryColors[item.category] || ''} variant="outline">{categoryLabels[item.category]}</Badge></td>
                    <td className="p-3 text-right font-semibold">${item.unitCost.toFixed(2)}</td>
                    <td className="p-3">{item.unit}</td>
                    <td className="p-3 text-muted-foreground">{item.vendor || '—'}</td>
                    {canDelete && (
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(item.bomItemId)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Card className="w-64"><CardContent className="p-4 flex justify-between items-center">
              <span className="text-sm font-medium">Total BOM Value:</span>
              <span className="text-lg font-bold text-primary">${totalCost.toFixed(2)}</span>
            </CardContent></Card>
          </div>
        </>
      )}
    </div>
  );
};
