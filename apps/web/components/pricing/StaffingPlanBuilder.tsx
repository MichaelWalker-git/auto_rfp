'use client';

import { useState } from 'react';
import { useLaborRates } from '@/lib/hooks/use-pricing';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Users, Calculator } from 'lucide-react';
import type { RateBasis } from '@auto-rfp/core';
import { StaffingPlanInfoPopover } from './StaffingPlanInfoPopover';

interface StaffingPlanBuilderProps {
  orgId: string;
}

interface PlanRow {
  id: string;
  position: string;
  hours: number;
  phase: string;
}

export const StaffingPlanBuilder = ({ orgId }: StaffingPlanBuilderProps) => {
  const { data: ratesData, isLoading: isLoadingRates } = useLaborRates(orgId);
  const laborRates = ratesData?.laborRates ?? [];

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [planName, setPlanName] = useState('');
  const [rateBasis, setRateBasis] = useState<RateBasis>('ONSHORE');

  const addRow = () => {
    setRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        position: laborRates[0]?.position ?? '',
        hours: 0,
        phase: '',
      },
    ]);
  };

  const updateRow = (id: string, field: keyof PlanRow, value: string | number) => {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeRow = (id: string) => {
    setRows(rows.filter(r => r.id !== id));
  };

  const rateByPos = new Map(laborRates.filter(r => r.isActive).map(r => [r.position, r]));

  // Resolve the billable rate for the selected basis. OFFSHORE falls back to the onshore
  // rate when a position has no offshore rate — mirroring the backend resolveRate — and the
  // fallback is flagged so the user sees which positions aren't actually priced offshore.
  const computedRows = rows.map(row => {
    const lr = rateByPos.get(row.position);
    let rate = 0;
    let offshoreFallback = false;
    if (lr) {
      if (rateBasis === 'OFFSHORE' && lr.offshoreFullyLoadedRate != null && lr.offshoreFullyLoadedRate > 0) {
        rate = lr.offshoreFullyLoadedRate;
      } else {
        rate = lr.fullyLoadedRate;
        offshoreFallback = rateBasis === 'OFFSHORE';
      }
    }
    const totalCost = Math.round(row.hours * rate * 100) / 100;
    return { ...row, rate, totalCost, offshoreFallback };
  });

  const totalLaborCost = computedRows.reduce((sum, r) => sum + r.totalCost, 0);
  const totalHours = computedRows.reduce((sum, r) => sum + r.hours, 0);
  const fallbackCount = computedRows.filter(r => r.offshoreFallback).length;

  if (isLoadingRates) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (laborRates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium">No labor rates defined</p>
          <p className="text-sm text-muted-foreground mt-1">
            Define labor rates in the &quot;Labor Rates&quot; tab before building a staffing plan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Staffing Plan Builder</h2>
          <div className="flex items-center gap-1">
            <p className="text-sm text-muted-foreground">
              Build staffing plans by selecting positions and hours. Rates are auto-populated from your labor rate table.
            </p>
            <StaffingPlanInfoPopover />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Build Staffing Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px]">
              <label className="text-sm font-medium">Plan Name</label>
              <Input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="e.g., Base Period Staffing Plan"
                className="max-w-md"
              />
            </div>
            <div className="w-56">
              <Label htmlFor="staffing-rate-basis" className="text-sm font-medium">Rate basis</Label>
              <Select value={rateBasis} onValueChange={(v) => setRateBasis(v as RateBasis)}>
                <SelectTrigger id="staffing-rate-basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONSHORE">Onshore (US-based)</SelectItem>
                  <SelectItem value="OFFSHORE">Offshore</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {rateBasis === 'OFFSHORE' && fallbackCount > 0 && (
            <p className="text-xs text-amber-600">
              {fallbackCount} position{fallbackCount > 1 ? 's have' : ' has'} no offshore rate and {fallbackCount > 1 ? 'are' : 'is'} priced at the onshore rate. Add an offshore rate in the Labor Rates tab to price {fallbackCount > 1 ? 'them' : 'it'} offshore.
            </p>
          )}

          {rows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Position</th>
                    <th className="text-right p-3 font-medium">Hours</th>
                    <th className="text-left p-3 font-medium">Phase</th>
                    <th className="text-right p-3 font-medium">Rate ($/hr)</th>
                    <th className="text-right p-3 font-medium">Total Cost</th>
                    <th className="text-right p-3 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {computedRows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="p-2">
                        <select
                          value={row.position}
                          onChange={(e) => updateRow(row.id, 'position', e.target.value)}
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                        >
                          <option value="">Select position...</option>
                          {laborRates.filter(r => r.isActive).map((rate) => (
                            <option key={rate.laborRateId} value={rate.position}>
                              {rate.position}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={row.hours || ''}
                          onChange={(e) => updateRow(row.id, 'hours', Number(e.target.value))}
                          className="w-24 text-right"
                          placeholder="0"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={row.phase}
                          onChange={(e) => updateRow(row.id, 'phase', e.target.value)}
                          className="w-40"
                          placeholder="Base Period"
                        />
                      </td>
                      <td className="p-3 text-right text-muted-foreground">
                        {row.rate > 0 ? `$${row.rate.toFixed(2)}` : '—'}
                        {row.offshoreFallback && row.rate > 0 && (
                          <span className="ml-1 text-[10px] text-amber-600" title="No offshore rate — using onshore">(onshore)</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {row.totalCost > 0 ? `$${row.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="p-2 text-right">
                        <PermissionDeleteButton requiredPermission="pricing:edit" variant="ghost" size="sm" onClick={() => removeRow(row.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PermissionButton requiredPermission="pricing:edit" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" />
            Add Position
          </PermissionButton>

          {rows.length > 0 && (
            <div className="flex justify-end gap-4">
              <Card className="w-80">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Positions:</span>
                    <span className="font-medium">{rows.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Hours:</span>
                    <span className="font-medium">{totalHours.toLocaleString()}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between">
                    <span className="font-medium">Total Labor Cost:</span>
                    <span className="text-lg font-bold text-primary">
                      ${totalLaborCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Rates Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Labor Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {laborRates.filter(r => r.isActive).map((rate) => {
              const hasOffshore = rate.offshoreFullyLoadedRate != null && rate.offshoreFullyLoadedRate > 0;
              const shown = rateBasis === 'OFFSHORE' && hasOffshore ? rate.offshoreFullyLoadedRate! : rate.fullyLoadedRate;
              const isFallback = rateBasis === 'OFFSHORE' && !hasOffshore;
              return (
                <Badge key={rate.laborRateId} variant="outline" className="py-1.5 px-3">
                  {rate.position}: ${shown.toFixed(2)}/hr
                  {isFallback && <span className="ml-1 text-amber-600">(onshore)</span>}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
