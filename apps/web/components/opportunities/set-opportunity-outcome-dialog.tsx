'use client';

import React, { useEffect, useState } from 'react';
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
import { useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import {
  OPPORTUNITY_STATUS_LABELS,
  LOSS_REASON_LABELS,
  STATE_NAMES,
  getStateRecordsLaw,
} from '@auto-rfp/core';
import type {
  OpportunityItem,
  OpportunityStatus,
  OpportunityUpdateRequest,
  WinData,
  LossData,
  LossReasonCategory,
  Jurisdiction,
} from '@auto-rfp/core';

interface SetOpportunityOutcomeDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityItem;
  onSuccess?: () => void;
}

// Outcome statuses selectable from the outcome card.
const OUTCOME_STATUSES: OpportunityStatus[] = ['WON', 'LOST', 'NO_BID', 'WITHDRAWN'];
const LOSS_REASONS = Object.entries(LOSS_REASON_LABELS) as [LossReasonCategory, string][];

export function SetOpportunityOutcomeDialog({
  isOpen,
  onOpenChange,
  orgId,
  projectId,
  oppId,
  opportunity,
  onSuccess,
}: SetOpportunityOutcomeDialogProps) {
  const { toast } = useToast();
  const { trigger: updateOpportunity, isMutating } = useUpdateOpportunity(orgId);

  const [status, setStatus] = useState<OpportunityStatus>('NO_BID');
  const [outcomeComment, setOutcomeComment] = useState('');
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | ''>('');
  const [state, setState] = useState('');
  // Win
  const [contractValue, setContractValue] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [awardDate, setAwardDate] = useState('');
  const [keyFactors, setKeyFactors] = useState('');
  // Loss
  const [lossReason, setLossReason] = useState<LossReasonCategory>('UNKNOWN');
  const [lossReasonDetails, setLossReasonDetails] = useState('');
  const [winningContractor, setWinningContractor] = useState('');
  const [lossDate, setLossDate] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const current = opportunity.status as OpportunityStatus | undefined;
    setStatus(current && OUTCOME_STATUSES.includes(current) ? current : 'NO_BID');
    setOutcomeComment(opportunity.outcomeComment ?? '');
    setJurisdiction(opportunity.jurisdiction ?? '');
    setState(opportunity.state ?? '');
    setContractValue(opportunity.winData?.contractValue?.toString() ?? '');
    setContractNumber(opportunity.winData?.contractNumber ?? '');
    setAwardDate(opportunity.winData?.awardDate?.split('T')[0] ?? '');
    setKeyFactors(opportunity.winData?.keyFactors ?? '');
    setLossReason(opportunity.lossData?.lossReason ?? 'UNKNOWN');
    setLossReasonDetails(opportunity.lossData?.lossReasonDetails ?? '');
    setWinningContractor(opportunity.lossData?.winningContractor ?? '');
    setLossDate(opportunity.lossData?.lossDate?.split('T')[0] ?? '');
  }, [isOpen, opportunity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (jurisdiction === 'STATE' && !state) {
      toast({ title: 'Select a state', description: 'Choose the state whose public records law applies.', variant: 'destructive' });
      return;
    }

    const patch: OpportunityUpdateRequest = {
      status,
      outcomeComment: outcomeComment.trim() || null,
      jurisdiction: jurisdiction || undefined,
      state: jurisdiction === 'STATE' ? (state || null) : null,
    };

    if (status === 'WON') {
      const winData: WinData = {
        contractValue: contractValue ? parseFloat(contractValue) : 0,
        awardDate: awardDate ? new Date(awardDate).toISOString() : new Date().toISOString(),
      };
      if (contractNumber.trim()) winData.contractNumber = contractNumber.trim();
      if (keyFactors.trim()) winData.keyFactors = keyFactors.trim();
      patch.winData = winData;
    } else if (status === 'LOST') {
      const lossData: LossData = {
        lossReason,
        lossDate: lossDate ? new Date(lossDate).toISOString() : new Date().toISOString(),
      };
      if (lossReasonDetails.trim()) lossData.lossReasonDetails = lossReasonDetails.trim();
      if (winningContractor.trim()) lossData.winningContractor = winningContractor.trim();
      patch.lossData = lossData;
    }

    try {
      await updateOpportunity({ projectId, oppId, patch });
      toast({ title: 'Outcome updated', description: `Status set to ${OPPORTUNITY_STATUS_LABELS[status]}.` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to update outcome', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Set Outcome</DialogTitle>
            <DialogDescription>Record the outcome of this opportunity.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="outcome-status">Outcome Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as OpportunityStatus)}>
                <SelectTrigger id="outcome-status"><SelectValue placeholder="Select outcome" /></SelectTrigger>
                <SelectContent>
                  {OUTCOME_STATUSES.map((s) => <SelectItem key={s} value={s}>{OPPORTUNITY_STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outcome-comment">Reason / Notes</Label>
              <Textarea
                id="outcome-comment"
                rows={2}
                value={outcomeComment}
                onChange={(e) => setOutcomeComment(e.target.value)}
                placeholder={
                  status === 'NO_BID' ? 'Why are we not bidding on this opportunity?'
                    : status === 'WITHDRAWN' ? 'Why are we withdrawing?'
                    : 'Context or comments about this outcome...'
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outcome-jurisdiction">Contract Jurisdiction</Label>
              <Select value={jurisdiction} onValueChange={(v) => { setJurisdiction(v as Jurisdiction); if (v !== 'STATE') setState(''); }}>
                <SelectTrigger id="outcome-jurisdiction"><SelectValue placeholder="Select federal or state" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FEDERAL">Federal</SelectItem>
                  <SelectItem value="STATE">State</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {jurisdiction === 'STATE' && (
              <div className="grid gap-2">
                <Label htmlFor="outcome-state">State</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="outcome-state"><SelectValue placeholder="Select a state" /></SelectTrigger>
                  <SelectContent>
                    {STATE_NAMES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {state && <p className="text-xs text-muted-foreground">Records request will cite the {getStateRecordsLaw(state)}.</p>}
              </div>
            )}

            {status === 'WON' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-contract-value">Contract Value ($)</Label>
                  <Input id="outcome-contract-value" type="number" value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="1500000" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-contract-number">Contract Number</Label>
                  <Input id="outcome-contract-number" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="GS-35F-0001" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-award-date">Award Date</Label>
                  <Input id="outcome-award-date" type="date" value={awardDate} onChange={(e) => setAwardDate(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-key-factors">Key Factors for Win</Label>
                  <Textarea id="outcome-key-factors" rows={2} value={keyFactors} onChange={(e) => setKeyFactors(e.target.value)} />
                </div>
              </>
            )}

            {status === 'LOST' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-loss-reason">Reason for Loss</Label>
                  <Select value={lossReason} onValueChange={(v) => setLossReason(v as LossReasonCategory)}>
                    <SelectTrigger id="outcome-loss-reason"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>
                      {LOSS_REASONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-loss-details">Details</Label>
                  <Textarea id="outcome-loss-details" rows={2} value={lossReasonDetails} onChange={(e) => setLossReasonDetails(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-winning-contractor">Winning Contractor</Label>
                  <Input id="outcome-winning-contractor" value={winningContractor} onChange={(e) => setWinningContractor(e.target.value)} placeholder="Name of the winning company" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="outcome-loss-date">Loss Date</Label>
                  <Input id="outcome-loss-date" type="date" value={lossDate} onChange={(e) => setLossDate(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>Cancel</Button>
            <Button type="submit" disabled={isMutating}>{isMutating ? 'Saving...' : 'Save Outcome'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
