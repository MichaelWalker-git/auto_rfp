'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  OPPORTUNITY_STATUS_LABELS,
  LOSS_REASON_LABELS,
  STATE_NAMES,
  getStateRecordsLaw,
} from '@auto-rfp/core';
import type { OpportunityItem, OpportunityStatus, LossReasonCategory } from '@auto-rfp/core';
import type { EditFormValues } from './useOpportunityHeaderActions';

const STATUS_OPTIONS: OpportunityStatus[] = [
  'IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'WITHDRAWN',
];

const EditFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  organizationName: z.string().trim().optional(),
  type: z.string().trim().optional(),
  setAside: z.string().trim().optional(),
  naicsCode: z.string().trim().optional(),
  pscCode: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  decisionDateIso: z.string().trim().optional().or(z.literal('')),
  contractStartDateIso: z.string().trim().optional().or(z.literal('')),
  // Status + outcome
  status: z.enum(['IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'WITHDRAWN']).optional(),
  outcomeComment: z.string().trim().optional(),
  jurisdiction: z.enum(['FEDERAL', 'STATE']).or(z.literal('')).optional(),
  state: z.string().trim().optional(),
  contractValue: z.string().trim().optional(),
  contractNumber: z.string().trim().optional(),
  awardDate: z.string().trim().optional().or(z.literal('')),
  keyFactors: z.string().trim().optional(),
  lossReason: z.enum([
    'PRICE_TOO_HIGH', 'PRICE_TOO_LOW', 'TECHNICAL_SCORE', 'PAST_PERFORMANCE',
    'INCUMBENT_ADVANTAGE', 'MISSING_CERTIFICATION', 'LATE_SUBMISSION', 'NON_COMPLIANT',
    'WITHDRAWN', 'NO_BID_DECISION', 'UNKNOWN', 'OTHER',
  ]).optional(),
  lossReasonDetails: z.string().trim().optional(),
  winningContractor: z.string().trim().optional(),
  lossDate: z.string().trim().optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  if (data.jurisdiction === 'STATE' && !data.state) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a state', path: ['state'] });
  }
});

interface OpportunityHeaderEditProps {
  opportunity: OpportunityItem;
  onSubmit: (values: EditFormValues) => Promise<void>;
  submitError: string | null;
  onClearError: () => void;
}

const LOSS_REASONS = Object.entries(LOSS_REASON_LABELS) as [LossReasonCategory, string][];

export const OpportunityHeaderEdit = ({
  opportunity,
  onSubmit,
  submitError,
  onClearError,
}: OpportunityHeaderEditProps) => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EditFormValues>({
    resolver: zodResolver(EditFormSchema),
  });

  useEffect(() => {
    reset({
      title: opportunity.title,
      description: opportunity.description || '',
      organizationName: opportunity.organizationName || '',
      type: opportunity.type || '',
      setAside: opportunity.setAside || '',
      naicsCode: opportunity.naicsCode || '',
      pscCode: opportunity.pscCode || '',
      contactName: opportunity.contactName || '',
      contactEmail: opportunity.contactEmail || '',
      decisionDateIso: opportunity.decisionDateIso ? opportunity.decisionDateIso.split('T')[0] : '',
      contractStartDateIso: opportunity.contractStartDateIso ? opportunity.contractStartDateIso.split('T')[0] : '',
      status: (opportunity.status as OpportunityStatus | undefined) ?? 'IDENTIFIED',
      outcomeComment: opportunity.outcomeComment || '',
      jurisdiction: opportunity.jurisdiction ?? '',
      state: opportunity.state || '',
      contractValue: opportunity.winData?.contractValue?.toString() ?? '',
      contractNumber: opportunity.winData?.contractNumber ?? '',
      awardDate: opportunity.winData?.awardDate ? opportunity.winData.awardDate.split('T')[0] : '',
      keyFactors: opportunity.winData?.keyFactors ?? '',
      lossReason: opportunity.lossData?.lossReason ?? 'UNKNOWN',
      lossReasonDetails: opportunity.lossData?.lossReasonDetails ?? '',
      winningContractor: opportunity.lossData?.winningContractor ?? '',
      lossDate: opportunity.lossData?.lossDate ? opportunity.lossData.lossDate.split('T')[0] : '',
    });
    onClearError();
  }, [opportunity, reset, onClearError]);

  const status = watch('status');
  const jurisdiction = watch('jurisdiction');
  const isTerminal = status === 'WON' || status === 'LOST' || status === 'NO_BID' || status === 'WITHDRAWN';

  return (
    <form id="opp-edit-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="opp-title">Title *</Label>
        <Input id="opp-title" placeholder="Opportunity title" autoFocus {...register('title')} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      {/* ── Bid status ────────────────────────────────────────────────── */}
      <div className="grid gap-1.5">
        <Label htmlFor="opp-status">Bid Status</Label>
        <Select value={status ?? 'IDENTIFIED'} onValueChange={(v) => setValue('status', v as OpportunityStatus)}>
          <SelectTrigger id="opp-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{OPPORTUNITY_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Outcome reason / comment — relevant for terminal statuses (esp. no-bid). */}
      {isTerminal && (
        <div className="grid gap-1.5">
          <Label htmlFor="opp-outcome-comment">Reason / Notes</Label>
          <Textarea
            id="opp-outcome-comment"
            rows={2}
            placeholder={
              status === 'NO_BID' ? 'Why are we not bidding on this opportunity?'
                : status === 'WITHDRAWN' ? 'Why are we withdrawing?'
                : 'Context or comments about this outcome...'
            }
            {...register('outcomeComment')}
          />
        </div>
      )}

      {/* Jurisdiction (terminal only — gates debrief vs. state records request) */}
      {isTerminal && (
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="opp-jurisdiction">Jurisdiction</Label>
            <Select
              value={jurisdiction || ''}
              onValueChange={(v) => { setValue('jurisdiction', v as 'FEDERAL' | 'STATE'); if (v !== 'STATE') setValue('state', ''); }}
            >
              <SelectTrigger id="opp-jurisdiction">
                <SelectValue placeholder="Federal or State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FEDERAL">Federal</SelectItem>
                <SelectItem value="STATE">State</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {jurisdiction === 'STATE' && (
            <div className="grid gap-1.5">
              <Label htmlFor="opp-state">State</Label>
              <Select value={watch('state') || ''} onValueChange={(v) => setValue('state', v)}>
                <SelectTrigger id="opp-state">
                  <SelectValue placeholder="Select a state" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_NAMES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              {watch('state') && (
                <p className="text-xs text-muted-foreground">Records request will cite the {getStateRecordsLaw(watch('state') as string)}.</p>
              )}
              {errors.state && <p className="text-xs text-destructive">{errors.state.message}</p>}
            </div>
          )}
        </div>
      )}

      {/* Win detail */}
      {status === 'WON' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="opp-contract-value">Contract Value ($)</Label>
            <Input id="opp-contract-value" type="number" placeholder="1500000" {...register('contractValue')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="opp-contract-number">Contract Number</Label>
            <Input id="opp-contract-number" placeholder="GS-35F-0001" {...register('contractNumber')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="opp-award-date">Award Date</Label>
            <Input id="opp-award-date" type="date" {...register('awardDate')} />
          </div>
          <div className="grid gap-1.5 col-span-2">
            <Label htmlFor="opp-key-factors">Key Factors for Win</Label>
            <Textarea id="opp-key-factors" rows={2} {...register('keyFactors')} />
          </div>
        </div>
      )}

      {/* Loss detail */}
      {status === 'LOST' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="opp-loss-reason">Reason for Loss</Label>
            <Select value={watch('lossReason') ?? 'UNKNOWN'} onValueChange={(v) => setValue('lossReason', v as LossReasonCategory)}>
              <SelectTrigger id="opp-loss-reason">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="opp-winning-contractor">Winning Contractor</Label>
            <Input id="opp-winning-contractor" placeholder="Name of winning company" {...register('winningContractor')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="opp-loss-date">Loss Date</Label>
            <Input id="opp-loss-date" type="date" {...register('lossDate')} />
          </div>
          <div className="grid gap-1.5 col-span-2">
            <Label htmlFor="opp-loss-details">Details</Label>
            <Textarea id="opp-loss-details" rows={2} {...register('lossReasonDetails')} />
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="opp-org">Organization</Label>
        <Input id="opp-org" placeholder="Organization name" {...register('organizationName')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-contact-name">Contact Name</Label>
          <Input id="opp-contact-name" placeholder="Point of contact" {...register('contactName')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-contact-email">Contact Email</Label>
          <Input id="opp-contact-email" type="email" placeholder="contact@agency.gov" {...register('contactEmail')} />
          {errors.contactEmail && <p className="text-xs text-destructive">{errors.contactEmail.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-type">Type</Label>
          <Input id="opp-type" placeholder="e.g., Solicitation" {...register('type')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-setaside">Set-Aside</Label>
          <Input id="opp-setaside" placeholder="e.g., 8(a)" {...register('setAside')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-naics">NAICS Code</Label>
          <Input id="opp-naics" placeholder="e.g., 541512" {...register('naicsCode')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-psc">PSC Code</Label>
          <Input id="opp-psc" placeholder="e.g., D302" {...register('pscCode')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-decision-date">Decision Date</Label>
          <Input id="opp-decision-date" type="date" {...register('decisionDateIso')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-contract-start">Contract Start Date</Label>
          <Input id="opp-contract-start" type="date" {...register('contractStartDateIso')} />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="opp-desc">Description</Label>
        <Textarea id="opp-desc" placeholder="Opportunity description" rows={3} {...register('description')} />
      </div>

      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
    </form>
  );
};
