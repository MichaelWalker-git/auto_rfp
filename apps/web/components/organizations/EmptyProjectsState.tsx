'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';

interface EmptyProjectsStateProps {
  onCreateProject: () => void;
}

export function EmptyProjectsState({ onCreateProject }: EmptyProjectsStateProps) {
  return (
    <div className="text-center p-8 border rounded-md">
      <p className="text-muted-foreground">No projects found</p>
      <Button 
        className="mt-4"
        onClick={onCreateProject}
      >
        <PlusIcon className="mr-2 h-4 w-4" />
        Create your first project
      </Button>
    </div>
  );
} 