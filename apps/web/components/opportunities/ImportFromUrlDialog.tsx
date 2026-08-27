'use client';

import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

interface Props {
  /** Resolves once the import request has been accepted. */
  onImport: (url: string, title?: string) => Promise<void>;
}

/**
 * Fallback entry for solicitations hosted somewhere without an API — a state
 * portal, an agency's own site, an emailed link.
 *
 * Deliberately understated: it sits below the provider search rather than beside
 * it, because full automation is impossible here. There is no provider metadata to
 * read (agency, NAICS, set-aside, deadline), no attachment discovery, and no
 * duplicate detection — just the one document at the end of the link, pushed
 * through the same analysis pipeline. Prefer the API providers whenever the
 * solicitation exists on one.
 */
export const ImportFromUrlDialog = ({ onImport }: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [isImporting, setImporting] = useState(false);

  const isValid = /^https:\/\/\S+$/i.test(url.trim());

  const handleImport = async () => {
    if (!isValid) return;
    setImporting(true);
    try {
      await onImport(url.trim(), title.trim() || undefined);
      setOpen(false);
      setUrl('');
      setTitle('');
    } catch (e: unknown) {
      toast({
        title: 'Import failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex justify-center pt-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            Solicitation not on SAM.gov or HigherGov? Import from a URL
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from a URL</DialogTitle>
            <DialogDescription>
              For solicitations hosted somewhere without an API. We fetch the document at
              this link and run the same analysis — but we can&apos;t read the agency,
              NAICS, set-aside or deadline, and we won&apos;t find any linked attachments.
              Use SAM.gov or HigherGov when the solicitation is available there.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="import-url">Document URL</Label>
              <Input
                id="import-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.gov/solicitations/rfp-2026-014.pdf"
                onKeyDown={(e) => { if (e.key === 'Enter' && isValid) { e.preventDefault(); handleImport(); } }}
              />
              {url.trim() !== '' && !isValid && (
                <p className="text-xs text-destructive">Enter a full https:// URL.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="import-title">Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="import-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to the file name"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isImporting}>Cancel</Button>
            </DialogClose>
            <Button type="button" onClick={handleImport} disabled={!isValid || isImporting}>
              {isImporting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</>
              ) : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
