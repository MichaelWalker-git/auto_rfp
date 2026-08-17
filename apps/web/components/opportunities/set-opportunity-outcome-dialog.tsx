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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
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
  EvaluationScores,
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

/** The criteria on EvaluationScoresSchema, in the order a scoring sheet lists them. */
const SCORE_CRITERIA = [
  { key: 'technical', label: 'Technical' },
  { key: 'price', label: 'Price' },
  { key: 'pastPerformance', label: 'Past Performance' },
  { key: 'management', label: 'Management' },
  { key: 'overall', label: 'Overall' },
] as const satisfies readonly { key: keyof EvaluationScores; label: string }[];

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/** The five score inputs held as raw strings, so an untouched box stays untouched. */
type ScoreInputs = Record<keyof EvaluationScores, string>;

/** Stored numbers back to input strings. A missing score stays an empty box, never a 0. */
const toScoreInputs = (stored: EvaluationScores | undefined): ScoreInputs => ({
  technical: stored?.technical?.toString() ?? '',
  price: stored?.price?.toString() ?? '',
  pastPerformance: stored?.pastPerformance?.toString() ?? '',
  management: stored?.management?.toString() ?? '',
  overall: stored?.overall?.toString() ?? '',
});

const EMPTY_SCORE_INPUTS = toScoreInputs(undefined);

/**
 * An empty (or unparseable) input yields `undefined` — deliberately NOT 0.
 *
 * A recorded bid of $0 is a factual claim about a procurement; a blank box means the
 * number is not known yet. Coercing the second into the first would feed the pricing
 * chart and the dashboard's coverage count a figure nobody entered.
 */
const parseOptionalNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

/** Collects only the criteria the user actually filled in. */
const collectScores = (inputs: ScoreInputs): EvaluationScores => {
  const scores: EvaluationScores = {};
  for (const { key } of SCORE_CRITERIA) {
    const value = parseOptionalNumber(inputs[key]);
    if (value !== undefined) scores[key] = value;
  }
  return scores;
};

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
  // Bid amounts and scores are held as strings, not numbers: '' has to stay
  // distinguishable from 0 all the way to submit.
  const [ourBidAmount, setOurBidAmount] = useState('');
  const [winningBidAmount, setWinningBidAmount] = useState('');
  const [scores, setScores] = useState<ScoreInputs>(EMPTY_SCORE_INPUTS);
  const [isScoresOpen, setIsScoresOpen] = useState(false);

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
    setOurBidAmount(opportunity.lossData?.ourBidAmount?.toString() ?? '');
    setWinningBidAmount(opportunity.lossData?.winningBidAmount?.toString() ?? '');
    const storedScores = opportunity.lossData?.evaluationScores;
    setScores(toScoreInputs(storedScores));
    // Open the disclosure when scores are already on file, so re-opening the dialog
    // does not hide numbers someone previously entered behind a collapsed section.
    setIsScoresOpen(Object.values(storedScores ?? {}).some((v) => typeof v === 'number'));
  }, [isOpen, opportunity]);

  const handleScoreChange = (key: keyof EvaluationScores, value: string) => {
    setScores((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (jurisdiction === 'STATE' && !state) {
      toast({ title: 'Select a state', description: 'Choose the state whose public records law applies.', variant: 'destructive' });
      return;
    }

    const enteredScores = status === 'LOST' ? collectScores(scores) : {};
    const enteredOurBid = status === 'LOST' ? parseOptionalNumber(ourBidAmount) : undefined;
    const enteredWinningBid = status === 'LOST' ? parseOptionalNumber(winningBidAmount) : undefined;

    /**
     * Reject rather than clamp. An out-of-range score is a typo or a sheet on a
     * different scale, and silently rewriting 105 to 100 would invent a score the
     * agency never gave — the dashboard renders these as bar widths and cannot tell.
     *
     * The inputs carry min/max, so a browser normally blocks this before submit. It
     * does NOT when the disclosure is collapsed: Radix unmounts the content, taking
     * the fields out of constraint validation while their values survive in state.
     * That path is why this runs here rather than relying on the attributes.
     */
    const outOfRange = SCORE_CRITERIA.filter(({ key }) => {
      const value = enteredScores[key];
      return value !== undefined && (value < SCORE_MIN || value > SCORE_MAX);
    });
    if (outOfRange.length > 0) {
      // Re-open the disclosure — otherwise the toast names a field the user cannot see.
      setIsScoresOpen(true);
      toast({
        title: 'Scores must be between 0 and 100',
        description: `Check ${outOfRange.map(({ label }) => label).join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }

    if ((enteredOurBid !== undefined && enteredOurBid < 0) || (enteredWinningBid !== undefined && enteredWinningBid < 0)) {
      toast({ title: 'Bid amounts cannot be negative', description: 'Enter the amount as a positive figure.', variant: 'destructive' });
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
      if (enteredOurBid !== undefined) lossData.ourBidAmount = enteredOurBid;
      if (enteredWinningBid !== undefined) lossData.winningBidAmount = enteredWinningBid;
      // Omit the whole object when nothing was scored — an empty `evaluationScores`
      // would make the dashboard count this loss as scored and render an empty card.
      if (Object.keys(enteredScores).length > 0) lossData.evaluationScores = enteredScores;
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="outcome-our-bid">Our Bid Amount ($)</Label>
                    <Input id="outcome-our-bid" type="number" min={0} step="any" value={ourBidAmount} onChange={(e) => setOurBidAmount(e.target.value)} placeholder="250000" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="outcome-winning-bid">Winning Bid Amount ($)</Label>
                    <Input id="outcome-winning-bid" type="number" min={0} step="any" value={winningBidAmount} onChange={(e) => setWinningBidAmount(e.target.value)} placeholder="198500" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave an amount blank if you do not know it yet — a blank field is
                  recorded as unknown, not as $0.
                </p>

                {/* Five more always-open inputs would push the loss reason off-screen,
                    and most losses are recorded before any debrief happens. */}
                <Collapsible open={isScoresOpen} onOpenChange={setIsScoresOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-0 text-muted-foreground">
                      {isScoresOpen ? 'Hide evaluation scores' : 'Add evaluation scores'}
                      <ChevronDown className={`h-4 w-4 transition-transform ${isScoresOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-3 pt-2">
                    <p className="text-xs text-muted-foreground">
                      From a debrief or a released scoring sheet. Scored 0&ndash;100; leave
                      any criterion blank if it was not scored or not disclosed.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {SCORE_CRITERIA.map(({ key, label }) => (
                        <div key={key} className="grid gap-2">
                          <Label htmlFor={`outcome-score-${key}`}>{label}</Label>
                          <Input
                            id={`outcome-score-${key}`}
                            type="number"
                            min={SCORE_MIN}
                            max={SCORE_MAX}
                            step="any"
                            value={scores[key]}
                            onChange={(e) => handleScoreChange(key, e.target.value)}
                            placeholder="0-100"
                          />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
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
