'use client';

import { useState } from 'react';
import { Plus, X, Loader2, FilePlus2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateFoiaCustomDocuments } from '@/lib/hooks/use-foia-artifacts';

/** Matches the schema cap in UpdateFoiaCustomDocumentsSchema. */
const MAX_ITEMS = 25;
const MAX_LENGTH = 500;

interface FoiaCustomDocumentsEditorProps {
  orgId: string;
  projectId: string;
  oppId: string;
  /** Current list from the stored FOIA request. */
  customDocumentRequests: readonly string[] | undefined;
  /** Called after a successful save so the parent can refetch. */
  onSaved: () => void | Promise<void>;
}

/**
 * Lets a reviewer add solicitation-specific document requests before approving.
 *
 * The automated letter asks for a standardized set, which is correct but generic.
 * A specialist reading the solicitation asks for named artifacts — "the Section 4.3
 * scoring worksheets", "the bid tabulation with SB preference computations" — and
 * those are the requests agencies actually honour, because they name records that
 * can be located.
 *
 * Deliberately the ONLY editable part of the letter. Everything else is derived from
 * records that can be checked (the agency address, the award date and its
 * provenance, whether a proposal was actually submitted); free-texting those would
 * let a reviewer assert something the app cannot substantiate in a statutory filing.
 * Extra document requests carry no such risk — the worst case is a "no such record"
 * reply.
 */
export const FoiaCustomDocumentsEditor = ({
  orgId,
  projectId,
  oppId,
  customDocumentRequests,
  onSaved,
}: FoiaCustomDocumentsEditorProps) => {
  const { toast } = useToast();
  const { updateCustomDocuments, isSaving } = useUpdateFoiaCustomDocuments();

  const [items, setItems] = useState<string[]>(() => [...(customDocumentRequests ?? [])]);
  const [draft, setDraft] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleAdd = () => {
    const value = draft.trim();
    if (!value || items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, value]);
    setDraft('');
  };

  const handleRemove = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      await updateCustomDocuments({
        orgId,
        projectId,
        oppId,
        customDocumentRequests: items,
      });

      toast({
        title: 'Document requests saved',
        description: 'The letter has been re-generated. Review it before sending.',
      });

      await onSaved();
      setIsOpen(false);
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const stored = customDocumentRequests ?? [];
  const isDirty =
    items.length !== stored.length || items.some((item, i) => item !== stored[i]);

  if (!isOpen) {
    return (
      <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
        <FilePlus2 className="h-3.5 w-3.5 mr-1" />
        {stored.length > 0
          ? `Additional documents (${stored.length})`
          : 'Add specific documents'}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium">Additional document requests</Label>
        <p className="text-xs text-muted-foreground">
          Name records this solicitation actually produces — e.g. &ldquo;Section 4.3 scoring
          worksheets&rdquo; or &ldquo;bid tabulation including SB preference computations&rdquo;.
          These are appended to the standard list.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, index) => (
            <li
              key={`${index}-${item}`}
              className="flex items-start gap-2 text-sm bg-muted/50 rounded px-2 py-1"
            >
              <span className="text-muted-foreground shrink-0">{index + 1}.</span>
              <span className="flex-1 break-words">{item}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => handleRemove(index)}
                aria-label={`Remove document request ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder="e.g. Section 4.3 individual evaluator scoresheets"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          disabled={items.length >= MAX_ITEMS}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!draft.trim() || items.length >= MAX_ITEMS}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {items.length >= MAX_ITEMS && (
        <p className="text-xs text-amber-600">
          Limit of {MAX_ITEMS} additional requests reached. A letter enumerating more reads as
          unserious and invites a &ldquo;unduly burdensome&rdquo; denial.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Save and re-generate letter
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            setItems([...stored]);
            setDraft('');
            setIsOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};
