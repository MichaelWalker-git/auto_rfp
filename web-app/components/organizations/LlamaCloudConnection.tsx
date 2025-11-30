'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Cloud, Loader2, AlertCircle, CheckCircle2, Unplug } from 'lucide-react';

interface LlamaCloudProject {
  id: string;
  name: string;
  description?: string;
  organization_id: string;
  organization_name: string;
  created_at: string;
  updated_at: string;
}

interface LlamaCloudConnectionProps {
  orgId: string;
  organization: any;
  onConnectionUpdate: (organization: any) => void;
}

export function LlamaCloudConnection({ orgId, organization, onConnectionUpdate }: LlamaCloudConnectionProps) {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [availableProjects, setAvailableProjects] = useState<LlamaCloudProject[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const isConnected = organization?.llamaCloudConnectedAt;
  const connectedProjectName = organization?.llamaCloudProjectName;
  const connectedProjectId = organization?.llamaCloudProjectId;

  // Fetch available projects using environment API key
  const fetchProjects = async () => {
    setIsFetchingProjects(true);
    setError(null);

    try {
      // Fetch projects through our API route (which uses environment variables on server side)
      const response = await fetch('/api/llamacloud/projects', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('LlamaCloud API key is not configured or invalid. Please check your environment variables.');
        }
        throw new Error('Failed to fetch projects from LlamaCloud.');
      }

      const data = await response.json();
      setAvailableProjects(data.projects || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch projects';
      setError(errorMessage);
      setAvailableProjects([]);
    } finally {
      setIsFetchingProjects(false);
    }
  }

  // Fetch projects when component mounts
  useEffect(() => {
    if (!isConnected) {
      fetchProjects();
    }
  }, [isConnected]);

  // Connect to LlamaCloud project
  const handleConnect = async () => {
    if (!selectedProjectId) {
      toast({
        title: 'Error',
        description: 'Please select a project.',
        variant: 'destructive',
      });
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const selectedProject = availableProjects.find(p => p.id === selectedProjectId);
      
      const response = await fetch('/api/llamacloud/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: orgId,
          projectId: selectedProjectId,
          projectName: selectedProject?.name || 'Unknown Project',
          llamaCloudOrgName: selectedProject?.organization_name || 'Unknown Organization',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to connect to LlamaCloud');
      }

      const updatedOrg = await response.json();
      onConnectionUpdate(updatedOrg.organization);

      toast({
        title: 'Success',
        description: `Connected to LlamaCloud project "${selectedProject?.name}"`,
      });

      // Clear form
      setSelectedProjectId('');
      setAvailableProjects([]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to LlamaCloud';
      setError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect from LlamaCloud
  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);

    try {
      const response = await fetch('/api/llamacloud/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: orgId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to disconnect from LlamaCloud');
      }

      const updatedOrg = await response.json();
      onConnectionUpdate(updatedOrg.organization);

      toast({
        title: 'Success',
        description: 'Disconnected from LlamaCloud',
      });

      // Refresh projects for potential reconnection
      fetchProjects();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect from LlamaCloud';
      setError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          LlamaCloud Integration
        </CardTitle>
        <CardDescription>
          Connect your organization to a LlamaCloud project for document indexing and search.
          The API key is configured via environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isConnected ? (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Connected to LlamaCloud</AlertTitle>
              <AlertDescription>
                {organization?.llamaCloudOrgName && organization?.llamaCloudProjectName ? 
                  `Connected to ${organization.llamaCloudOrgName} - ${organization.llamaCloudProjectName}` :
                  `Your organization is connected to the LlamaCloud project "${connectedProjectName}"`
                }
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <Unplug className="h-4 w-4 mr-2" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Environment Configuration</AlertTitle>
              <AlertDescription>
                LlamaCloud API key is configured via environment variables. 
                Make sure LLAMACLOUD_API_KEY is set in your environment.
              </AlertDescription>
            </Alert>

            {isFetchingProjects && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching available projects...
              </div>
            )}

            {availableProjects.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="project-select">Select LlamaCloud Project</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a project to connect to" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {project.organization_name} - {project.name}
                          </span>
                          {project.description && (
                            <span className="text-xs text-muted-foreground">{project.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This will connect your organization to the selected LlamaCloud project
                </p>
              </div>
            )}

            {!isFetchingProjects && availableProjects.length === 0 && !error && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No Projects Found</AlertTitle>
                <AlertDescription>
                  No projects were found. Make sure you have created a project in LlamaCloud and the API key is properly configured.
                </AlertDescription>
              </Alert>
            )}

            <Button 
              onClick={handleConnect}
              disabled={!selectedProjectId || isConnecting || isFetchingProjects}
              className="w-full"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4 mr-2" />
                  Connect to LlamaCloud
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 