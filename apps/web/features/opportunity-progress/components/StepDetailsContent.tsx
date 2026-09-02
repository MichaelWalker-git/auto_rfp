'use client';

import { Check, Circle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STEP_META_BY_ID } from '../lib/steps';
import { ANALYSIS_SECTION_KEYS, isFormFilled, unfilledFieldCount } from '../lib/rules';
import { STATUS_DISPLAY } from '../lib/status-display';
import type {
  ProgressStep,
  AnalysisDomain,
  RequiredFormsDomain,
  RfpDocumentsDomain,
} from '../lib/types';

// ─── Per-item row ───────────────────────────────────────────────────────────────

interface ItemRowProps {
  label: string;
  done: boolean;
  hint?: string;
}

const ItemRow = ({ label, done, hint }: ItemRowProps) => (
  <li className="flex items-center gap-2 text-sm">
    {done ? (
      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
    ) : (
      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
    )}
    <span className={cn('truncate', done ? 'text-foreground' : 'text-muted-foreground')}>
      {label}
    </span>
    {hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{hint}</span>}
  </li>
);

// ─── Section labels for the analysis step ────────────────────────────────────────

const SECTION_LABELS: Record<(typeof ANALYSIS_SECTION_KEYS)[number], string> = {
  summary: 'Summary',
  deadlines: 'Deadlines',
  requirements: 'Requirements',
  contacts: 'Contacts',
  risks: 'Risks',
  pricing: 'Pricing',
  pastPerformance: 'Past performance',
  scoring: 'Scoring',
};

// ─── Per-step item lists ─────────────────────────────────────────────────────────

const AnalysisItems = ({ data }: { data: AnalysisDomain }) => {
  const sections = data.brief?.sections;
  return (
    <ul className="space-y-1">
      {ANALYSIS_SECTION_KEYS.map((key) => (
        <ItemRow
          key={key}
          label={SECTION_LABELS[key]}
          done={sections?.[key]?.status === 'COMPLETE'}
        />
      ))}
    </ul>
  );
};

const RequiredFormsItems = ({ data }: { data: RequiredFormsDomain }) => (
  <ul className="space-y-1">
    {data.forms.map((form, i) => {
      const filled = isFormFilled(form);
      const hint = filled
        ? 'Filled'
        : `${unfilledFieldCount(form)} of ${form.totalFieldCount} to fill`;
      return (
        <ItemRow key={form.name || i} label={form.name || 'Untitled form'} done={filled} hint={hint} />
      );
    })}
  </ul>
);

const RfpDocumentsItems = ({ data }: { data: RfpDocumentsDomain }) => {
  const readyTypes = new Set(
    data.documents.filter((d) => d.status === 'READY' || d.status === 'APPROVED').map((d) => d.documentType),
  );

  // Primary path: show the brief's mandatory required-documents list and its
  // readiness (entries flagged `required: false` are optional — excluded, matching
  // the rule's denominator).
  const mandatoryDocs = (data.requiredDocuments ?? []).filter((req) => req.required !== false);
  if (mandatoryDocs.length > 0) {
    return (
      <ul className="space-y-1">
        {mandatoryDocs.map((req, i) => (
          <ItemRow
            key={req.name || i}
            label={req.name || String(req.documentType)}
            done={readyTypes.has(req.documentType)}
            hint={readyTypes.has(req.documentType) ? 'Ready' : 'Not ready'}
          />
        ))}
      </ul>
    );
  }

  // Fallback: readiness of the documents that exist.
  if (data.documents.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {data.documents.map((doc, i) => {
        const ready = doc.status === 'READY' || doc.status === 'APPROVED';
        return (
          <ItemRow
            key={doc.name || i}
            label={doc.title || doc.name || String(doc.documentType)}
            done={ready}
            hint={ready ? 'Ready' : (doc.status ?? 'Draft')}
          />
        );
      })}
    </ul>
  );
};

// ─── Popover body ─────────────────────────────────────────────────────────────

export const StepDetailsContent = ({ step }: { step: ProgressStep }) => {
  const meta = STEP_META_BY_ID[step.stepId];
  const StatusIcon = STATUS_DISPLAY[step.status].icon;

  const renderItems = () => {
    if (!step.domainData) return null;
    switch (step.stepId) {
      case 'analysis':
        return <AnalysisItems data={step.domainData as AnalysisDomain} />;
      case 'required-forms':
        return <RequiredFormsItems data={step.domainData as RequiredFormsDomain} />;
      case 'rfp-documents':
        return <RfpDocumentsItems data={step.domainData as RfpDocumentsDomain} />;
      default:
        return null;
    }
  };

  const items = renderItems();

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <StatusIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-medium">{step.detailText}</span>
      </div>

      {step.reason && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{step.reason}</span>
        </div>
      )}

      {items}
    </div>
  );
};
