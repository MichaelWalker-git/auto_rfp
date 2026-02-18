'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Loader2, Link2, Layers } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useOrganization } from '@/lib/hooks/use-api';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import PermissionWrapper from '@/components/permission-wrapper';

interface ClusteringSettingsProps {
  orgId: string;
}

// Default values (match backend)
const DEFAULT_CLUSTER_THRESHOLD = 80;
const DEFAULT_SIMILAR_THRESHOLD = 50;

export function ClusteringSettings({ orgId }: ClusteringSettingsProps) {
  const { data: organization, mutate } = useOrganization(orgId);
  const { toast } = useToast();
  
  const [clusterThreshold, setClusterThreshold] = useState(DEFAULT_CLUSTER_THRESHOLD);
  const [similarThreshold, setSimilarThreshold] = useState(DEFAULT_SIMILAR_THRESHOLD);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load initial values from organization
  useEffect(() => {
    if (organization) {
      const orgCluster = (organization as any).clusterThreshold;
      const orgSimilar = (organization as any).similarThreshold;
      
      // Convert from 0-1 to percentage (0-100)
      setClusterThreshold(
        orgCluster != null ? Math.round(orgCluster * 100) : DEFAULT_CLUSTER_THRESHOLD
      );
      setSimilarThreshold(
        orgSimilar != null ? Math.round(orgSimilar * 100) : DEFAULT_SIMILAR_THRESHOLD
      );
      setHasChanges(false);
    }
  }, [organization]);

  const handleClusterChange = (value: number[]) => {
    const newValue = value[0] ?? DEFAULT_CLUSTER_THRESHOLD;
    setClusterThreshold(newValue);
    setHasChanges(true);
    
    // Ensure similar threshold is always <= cluster threshold
    if (similarThreshold > newValue) {
      setSimilarThreshold(newValue);
    }
  };

  const handleSimilarChange = (value: number[]) => {
    const newValue = value[0] ?? DEFAULT_SIMILAR_THRESHOLD;
    setSimilarThreshold(newValue);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      const response = await authFetcher(`${env.BASE_API_URL}/organization/edit-organization/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          clusterThreshold: clusterThreshold / 100, // Convert to 0-1
          similarThreshold: similarThreshold / 100, // Convert to 0-1
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update settings');
      }

      await mutate();
      setHasChanges(false);
      
      toast({
        title: 'Settings saved',
        description: 'Clustering thresholds updated successfully.',
      });
    } catch (error) {
      console.error('Error saving clustering settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save clustering settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setClusterThreshold(DEFAULT_CLUSTER_THRESHOLD);
    setSimilarThreshold(DEFAULT_SIMILAR_THRESHOLD);
    setHasChanges(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Question Clustering Settings
        </CardTitle>
        <CardDescription>
          Configure how similar questions are grouped together. Higher thresholds require questions to be more similar before grouping.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto-Cluster Threshold */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="cluster-threshold" className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              Auto-Cluster Threshold
            </Label>
            <span className="text-sm font-medium text-blue-600">{clusterThreshold}%</span>
          </div>
          <Slider
            id="cluster-threshold"
            min={50}
            max={100}
            step={5}
            value={[clusterThreshold]}
            onValueChange={handleClusterChange}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Questions with similarity ≥ {clusterThreshold}% are automatically grouped together during answer generation.
            Master question answers are copied to cluster members.
          </p>
        </div>

        {/* Similar Suggestion Threshold */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="similar-threshold" className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-green-600" />
              Similar Suggestion Threshold
            </Label>
            <span className="text-sm font-medium text-green-600">{similarThreshold}%</span>
          </div>
          <Slider
            id="similar-threshold"
            min={30}
            max={clusterThreshold}
            step={5}
            value={[similarThreshold]}
            onValueChange={handleSimilarChange}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Questions with similarity ≥ {similarThreshold}% (but &lt; {clusterThreshold}%) are shown as suggestions
            in the "Similar Questions" panel, allowing you to manually apply answers.
          </p>
        </div>

        {/* Visual guide */}
        <div className="rounded-md bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">Threshold Guide:</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span>≥ {clusterThreshold}%: Auto-clustered (answers copied automatically)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span>{similarThreshold}% - {clusterThreshold - 1}%: Suggested (manual apply)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full bg-gray-300"></span>
            <span>&lt; {similarThreshold}%: Not shown</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={handleReset} disabled={isSaving}>
          Reset to Defaults
        </Button>
        <PermissionWrapper requiredPermission="org:edit">
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </PermissionWrapper>
      </CardFooter>
    </Card>
  );
}