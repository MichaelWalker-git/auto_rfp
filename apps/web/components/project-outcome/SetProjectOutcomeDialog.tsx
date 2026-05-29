'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useSetProjectOutcome } from '@/lib/hooks/use-set-project-outcome';
import type {
  ProjectOutcomeStatus,
  SetProjectOutcomeRequest,
  WinData,
  LossData,
  LossReasonCategory,
  ProjectOutcome,
} from '@auto-rfp/core';

interface SetProjectOutcomeDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId?: string;
  currentOutcome?: ProjectOutcome | null;
  onSuccess?: (outcome: ProjectOutcome) => void;
}

const LOSS_REASONS: { value: LossReasonCategory; label: string }[] = [
  { value: 'PRICE_TOO_HIGH', label: 'Price Too High' },
  { value: 'PRICE_TOO_LOW', label: 'Price Too Low (Raised Concerns)' },
  { value: 'TECHNICAL_SCORE', label: 'Technical Score' },
  { value: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { value: 'INCUMBENT_ADVANTAGE', label: 'Incumbent Advantage' },
  { value: 'MISSING_CERTIFICATION', label: 'Missing Certification' },
  { value: 'LATE_SUBMISSION', label: 'Late Submission' },
  { value: 'NON_COMPLIANT', label: 'Non-Compliant' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'NO_BID_DECISION', label: 'No-Bid Decision' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

export function SetProjectOutcomeDialog({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  currentOutcome,
  onSuccess,
}: SetProjectOutcomeDialogProps) {
  const [status, setStatus] = useState<ProjectOutcomeStatus>('PENDING');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { setOutcome } = useSetProjectOutcome();

  // Win data fields
  const [contractValue, setContractValue] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [awardDate, setAwardDate] = useState('');
  const [keyFactors, setKeyFactors] = useState('');

  // Loss data fields
  const [lossReason, setLossReason] = useState<LossReasonCategory>('UNKNOWN');
  const [lossReasonDetails, setLossReasonDetails] = useState('');
  const [winningContractor, setWinningContractor] = useState('');
  const [lossDate, setLossDate] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStatus(currentOutcome?.status ?? 'PENDING');

      // Reset win data
      setContractValue(currentOutcome?.winData?.contractValue?.toString() ?? '');
      setContractNumber(currentOutcome?.winData?.contractNumber ?? '');
      setAwardDate(currentOutcome?.winData?.awardDate?.split('T')[0] ?? '');
      setKeyFactors(currentOutcome?.winData?.keyFactors ?? '');

      // Reset loss data
      setLossReason(currentOutcome?.lossData?.lossReason ?? 'UNKNOWN');
      setLossReasonDetails(currentOutcome?.lossData?.lossReasonDetails ?? '');
      setWinningContractor(currentOutcome?.lossData?.winningContractor ?? '');
      setLossDate(currentOutcome?.lossData?.lossDate?.split('T')[0] ?? '');
    }
  }, [isOpen, currentOutcome]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const payload = {
        projectId,
        orgId,
        opportunityId,
        status,
      } as SetProjectOutcomeRequest;

      // Add win data if WON
      if (status === 'WON') {
        const winData: Partial<WinData> = {
          contractValue: contractValue ? parseFloat(contractValue) : 0,
          awardDate: awardDate ? new Date(awardDate).toISOString() : new Date().toISOString(),
        };
        if (contractNumber) winData.contractNumber = contractNumber;
        if (keyFactors) winData.keyFactors = keyFactors;
        payload.winData = winData as WinData;
      }

      // Add loss data if LOST
      if (status === 'LOST') {
        const lossData: LossData = {
          lossReason,
          lossDate: lossDate ? new Date(lossDate).toISOString() : new Date().toISOString(),
        };
        if (lossReasonDetails) lossData.lossReasonDetails = lossReasonDetails;
        if (winningContractor) lossData.winningContractor = winningContractor;
        payload.lossData = lossData;
      }

      const result = await setOutcome(payload);

      toast({
        title: 'Outcome Updated',
        description: `Project outcome set to ${status}`,
      });

      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update outcome',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Set Project Outcome</DialogTitle>
            <DialogDescription>
              Record the outcome of this opportunity.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Status Selection */}
            <div className="grid gap-2">
              <Label htmlFor="status">Outcome Status</Label>
              <Select value={status} onValueChange={(value: ProjectOutcomeStatus) => setStatus(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="WON">Won</SelectItem>
                  <SelectItem value="LOST">Lost</SelectItem>
                  <SelectItem value="NO_BID">No Bid</SelectItem>
                  <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Win Data Fields */}
            {status === 'WON' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="contractValue">Contract Value ($)</Label>
                  <Input
                    id="contractValue"
                    type="number"
                    value={contractValue}
                    onChange={(e) => setContractValue(e.target.value)}
                    placeholder="e.g., 1500000"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractNumber">Contract Number</Label>
                  <Input
                    id="contractNumber"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    placeholder="e.g., GS-35F-0001"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="awardDate">Award Date</Label>
                  <Input
                    id="awardDate"
                    type="date"
                    value={awardDate}
                    onChange={(e) => setAwardDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="keyFactors">Key Factors for Win</Label>
                  <Textarea
                    id="keyFactors"
                    value={keyFactors}
                    onChange={(e) => setKeyFactors(e.target.value)}
                    placeholder="What contributed to winning this contract?"
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Loss Data Fields */}
            {status === 'LOST' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="lossReason">Reason for Loss</Label>
                  <Select value={lossReason} onValueChange={(value: LossReasonCategory) => setLossReason(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOSS_REASONS.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lossReasonDetails">Details</Label>
                  <Textarea
                    id="lossReasonDetails"
                    value={lossReasonDetails}
                    onChange={(e) => setLossReasonDetails(e.target.value)}
                    placeholder="Additional details about why the bid was lost..."
                    rows={3}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="winningContractor">Winning Contractor</Label>
                  <Input
                    id="winningContractor"
                    value={winningContractor}
                    onChange={(e) => setWinningContractor(e.target.value)}
                    placeholder="Name of the winning company"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lossDate">Loss Date</Label>
                  <Input
                    id="lossDate"
                    type="date"
                    value={lossDate}
                    onChange={(e) => setLossDate(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Outcome'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
