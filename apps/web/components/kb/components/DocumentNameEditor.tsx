'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export const DOCUMENT_NAME_MAX_LENGTH = 255;
export const DOCUMENT_NAME_REQUIRED_MESSAGE = 'Document name is required.';
export const DOCUMENT_NAME_TOO_LONG_MESSAGE = `Document names are limited to ${DOCUMENT_NAME_MAX_LENGTH} characters.`;
export const DOCUMENT_NAME_SAVE_FAILED_MESSAGE = "Couldn't rename the document — press Enter to retry.";

export interface DocumentRenameResult {
  outcome: 'saved' | 'duplicate' | 'error';
  message?: string;
}

interface DocumentNameEditorProps {
  /** The document's current name — prefills the input and is used to detect a no-op save. */
  initialValue: string;
  /** Persist the (trimmed) name. */
  onSave: (value: string) => Promise<DocumentRenameResult>;
  /** Close the editor — cancel, successful save, or no-op save. */
  onDone: () => void;
}

/**
 * Inline document-name editor swapped in for a DocumentCard's name span.
 * Enter or blur commits, Escape cancels without saving. Empty/whitespace-only
 * input never reaches the API; a duplicate-name (409) or other save failure keeps
 * the typed value and shows the server's message inline so the user can retry.
 */
export const DocumentNameEditor = ({ initialValue, onSave, onDone }: DocumentNameEditorProps) => {
  const [value, setValue] = useState(initialValue);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Blur fires when the input is disabled mid-save — it must not cancel.
  const isSavingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a stray blur firing before autoFocus has actually landed.
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      hasFocusedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setErrorMessage(DOCUMENT_NAME_REQUIRED_MESSAGE);
      return;
    }
    if (trimmed.length > DOCUMENT_NAME_MAX_LENGTH) {
      setErrorMessage(DOCUMENT_NAME_TOO_LONG_MESSAGE);
      return;
    }
    if (trimmed === initialValue) {
      onDone();
      return;
    }

    setErrorMessage(null);
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const { outcome, message } = await onSave(trimmed);
      if (outcome === 'saved') {
        onDone();
        return;
      }
      // Value is kept in state — the user can edit or press Enter to retry.
      setErrorMessage(message ?? DOCUMENT_NAME_SAVE_FAILED_MESSAGE);
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
    void handleSave();
  };

  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSaving}
        aria-label="Document name"
        aria-invalid={!!errorMessage}
        maxLength={DOCUMENT_NAME_MAX_LENGTH}
        className="h-8"
        data-testid="document-name-input"
      />
      {errorMessage && (
        <p role="alert" className="text-xs text-destructive" data-testid="document-name-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
