'use client';

import { useState } from 'react';
import { ArrowDownToLine, Heart, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useHigherGovFavorites, useImportHigherGovFavorites } from '@/lib/hooks/use-highergov-favorites';

interface Props {
  orgId: string;
  projectId?: string;
}

export const HigherGovFavoritesBanner = ({ orgId, projectId }: Props) => {
  const { toast } = useToast();
  const { unimportedCount, totalCount, configured, isLoading, error, refresh } = useHigherGovFavorites(orgId);
  const { importFavorites, isImporting } = useImportHigherGovFavorites();
  const [dismissed, setDismissed] = useState(false);

  // Don't show if not configured, still loading, no unimported, error, or dismissed
  if (!configured || isLoading || unimportedCount === 0 || dismissed || error) return null;

  const handleImportAll = async () => {
    if (!projectId) {
      toast({ title: 'No project selected', description: 'Please select a project to import into.', variant: 'destructive' });
      return;
    }
    try {
      const resp = await importFavorites({ orgId, projectId });
      toast({
        title: 'HigherGov favorites imported',
        description: `${resp.summary.imported} imported, ${resp.summary.skipped} already existed`,
      });
      refresh();
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' });
    }
  };

  return (
    <Alert className="mb-4 border-violet-200 bg-violet-50/50">
      <Heart className="h-4 w-4 text-violet-600" />
      <AlertTitle className="text-violet-800">HigherGov favorites available</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-sm text-violet-700">
          You have <Badge variant="secondary" className="mx-1">{unimportedCount}</Badge>
          favorited {unimportedCount === 1 ? 'opportunity' : 'opportunities'} in HigherGov
          that {unimportedCount === 1 ? 'hasn\'t' : 'haven\'t'} been imported yet
          {totalCount > unimportedCount && (
            <span className="text-violet-500"> ({totalCount - unimportedCount} of {totalCount} already imported)</span>
          )}.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleImportAll}
            disabled={isImporting || !projectId}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {isImporting ? (
              <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Importing...</>
            ) : (
              <><ArrowDownToLine className="mr-2 h-3.5 w-3.5" />Import All Favorites</>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} className="text-violet-600">
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};
