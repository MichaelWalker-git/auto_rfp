'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ComplianceFinding } from '@auto-rfp/core';

import { usePackageEditChat } from '../hooks/usePackageEditChat';
import { usePackageEditRun } from '../hooks/usePackageEditRun';
import { seedInstructionFromFinding } from '../lib/seedInstructionFromFinding';
import { ProposalRunView } from './ProposalRunView';

interface InlineFindingEditorProps {
  finding: ComplianceFinding;
  orgId: string;
  projectId: string;
  oppId: string;
  /**
   * Resolve the originating finding. When provided, the run view offers an
   * "Apply & resolve finding" action (resolves only if an edit actually applied).
   */
  onResolve?: (fingerprint: string) => void | Promise<void>;
}

/**
 * The "fix it where you found it" composer, rendered inside a finding card. Seeds
 * an edit instruction from the finding, lets the user confirm/tweak it, sends it
 * (edit intent), and renders the proposal run inline — no navigation.
 */
export const InlineFindingEditor = ({
  finding,
  orgId,
  projectId,
  oppId,
  onResolve,
}: InlineFindingEditorProps) => {
  const { sendMessage, isSending } = usePackageEditChat(orgId, projectId, oppId);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  // Poll THIS editor's own run (pinned by runId), not the opportunity's latest —
  // otherwise a run started elsewhere could hijack this inline view (W2).
  const { run, refresh } = usePackageEditRun(orgId, projectId, oppId, runId);

  const [instruction, setInstruction] = useState(() => seedInstructionFromFinding(finding));
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const text = instruction.trim();
    if (!text || isSending) return;
    setError(null);
    try {
      const response = await sendMessage(text);
      if (response?.intent === 'EDIT') {
        setRunId(response.runId);
        setStarted(true);
        await refresh();
      } else {
        // A REVIEW/clarify turn: surface the model's reply so the user can act on
        // it, rather than a generic "that didn't start an edit".
        setError(
          response?.answer?.trim() ||
            'That did not start an edit. Try rewording the instruction as a change to make.',
        );
      }
    } catch (err) {
      setError((err as Error)?.message ?? 'Something went wrong. Please try again.');
    }
  };

  // Discard the current proposals and return to the composer so the user can
  // reword the request. Keeps the last instruction so they can tweak rather than
  // retype it. The abandoned run stays server-side but is no longer shown; the
  // next send creates a fresh run that supersedes it.
  const handleDiscard = () => {
    setStarted(false);
    setRunId(undefined);
    setError(null);
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
      {!started && (
        <>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            disabled={isSending}
            aria-label="Edit instruction"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSend} disabled={isSending || !instruction.trim()}>
              {isSending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Send className="mr-1 h-4 w-4" /> Propose edits
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {started && run && (
        <ProposalRunView
          orgId={orgId}
          projectId={projectId}
          oppId={oppId}
          runId={runId}
          onApplied={refresh}
          onResolveFinding={onResolve ? () => onResolve(finding.fingerprint) : undefined}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
};
