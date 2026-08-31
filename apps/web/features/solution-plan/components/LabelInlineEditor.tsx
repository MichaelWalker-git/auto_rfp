'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { VersionLabelSaveResult } from '../hooks/useVersionLabel';

export const VERSION_LABEL_MAX_LENGTH = 100;
export const LABEL_TOO_LONG_MESSAGE = `Labels are limited to ${VERSION_LABEL_MAX_LENGTH} characters.`;
export const LABEL_SAVE_FAILED_MESSAGE = "Couldn't save the label — press Enter to retry.";

interface LabelInlineEditorProps {
  /** The version's current label — prefills the input (W5). */
  initialValue: string;
  /** Persist the (trimmed) value; empty string clears the label. */
  onSave: (value: string) => Promise<VersionLabelSaveResult>;
  /** Close the editor — cancel, successful save, or vanished version. */
  onDone: () => void;
}

/**
 * Inline label editor for a history row / the view modal footer (W5).
 * Enter saves, Escape cancels, blur cancels without saving. Over-long input
 * shows an inline validation message and never calls the API; a server-side
 * length rejection shows the SAME message; any other save failure keeps the
 * typed value with a retry hint. Presentation-only — persistence lives in
 * `useVersionLabel`, handed in via `onSave`.
 */
export const LabelInlineEditor = ({ initialValue, onSave, onDone }: LabelInlineEditorProps) => {
  const [value, setValue] = useState(initialValue);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Blur fires when the input is disabled mid-save — it must not cancel.
  const isSavingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The editor usually opens from a closing Radix menu whose focus restore
  // races a plain autoFocus and would blur (= cancel) the editor instantly.
  // Take focus one tick later and ignore blurs until the input has it.
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      hasFocusedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (trimmed.length > VERSION_LABEL_MAX_LENGTH) {
      setErrorMessage(LABEL_TOO_LONG_MESSAGE);
      return;
    }

    setErrorMessage(null);
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const { outcome } = await onSave(trimmed);
      if (outcome === 'saved' || outcome === 'not-found') {
        onDone();
        return;
      }
      // Value is kept in state — the user can edit or press Enter to retry.
      setErrorMessage(outcome === 'validation' ? LABEL_TOO_LONG_MESSAGE : LABEL_SAVE_FAILED_MESSAGE);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSave();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    }
  };

  const handleBlur = () => {
    if (isSavingRef.current || !hasFocusedRef.current) return;
    onDone();
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSaving}
        placeholder="Label this version (empty clears)"
        aria-label="Version label"
        aria-invalid={!!errorMessage}
        className="h-8"
        data-testid="version-label-input"
      />
      {errorMessage && (
        <p role="alert" className="text-xs text-destructive" data-testid="version-label-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
