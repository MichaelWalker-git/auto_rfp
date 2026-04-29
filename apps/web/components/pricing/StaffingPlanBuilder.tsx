'use client';

import { useState } from 'react';
import { useLaborRates } from '@/lib/hooks/use-pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, Users, Calculator } from 'lucide-react';
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

  const rateMap = new Map(laborRates.filter(r => r.isActive).map(r => [r.position, r.fullyLoadedRate]));

  const computedRows = rows.map(row => {
    const rate = rateMap.get(row.position) ?? 0;
    const totalCost = Math.round(row.hours * rate * 100) / 100;
    return { ...row, rate, totalCost };
  });

  const totalLaborCost = computedRows.reduce((sum, r) => sum + r.totalCost, 0);
  const totalHours = computedRows.reduce((sum, r) => sum + r.hours, 0);

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
          <div>
            <label className="text-sm font-medium">Plan Name</label>
            <Input
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="e.g., Base Period Staffing Plan"
              className="max-w-md"
            />
          </div>

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
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {row.totalCost > 0 ? `$${row.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => removeRow(row.id)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" />
            Add Position
          </Button>

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
            {laborRates.filter(r => r.isActive).map((rate) => (
              <Badge key={rate.laborRateId} variant="outline" className="py-1.5 px-3">
                {rate.position}: ${rate.fullyLoadedRate.toFixed(2)}/hr
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
