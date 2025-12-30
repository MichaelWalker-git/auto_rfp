'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Calendar, Loader2 } from 'lucide-react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useToast } from "@/components/ui/use-toast";

interface ExportDeadlinesButtonProps {
  // Required: specify what to export
  orgId?: string;
  projectId?: string;
  
  // Variant: 'batch' = dropdown with options, 'single' = direct button
  variant: 'batch' | 'single';
  
  // For 'single' variant only
  deadlineType?: 'submission' | 'questions' | 'site-visit';
  
  // Optional styling
  size?: 'default' | 'sm' | 'lg' | 'icon';
  buttonVariant?: 'default' | 'outline' | 'ghost' | 'secondary';
}

export default function ExportDeadlinesButton({
  orgId,
  projectId,
  variant,
  deadlineType,
  size = 'sm',
  buttonVariant = 'outline',
}: ExportDeadlinesButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

    const { toast } = useToast();

  const exportCalendar = async (type?: string) => {
    setIsExporting(true);
    
    try {
      const params = new URLSearchParams();
      if (orgId) params.append('orgId', orgId);
      if (projectId) params.append('projectId', projectId);
      if (type && type !== 'all') params.append('deadlineType', type);

      const url = `${env.BASE_API_URL}/deadlines/export-calendar?${params.toString()}`;
      
      const response = await authFetcher(url, { method: 'GET' });

      if (!response.ok) {
        throw new Error('Failed to export calendar');
      }

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'rfp-deadlines.ics';

      // Download the file
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Export error:', err);
      toast({
        title: 'Error',
        description: 'Failed to export calendar. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Single variant - just a button
  if (variant === 'single') {
    return (
      <Button
        variant={buttonVariant}
        size={size}
        onClick={() => exportCalendar(deadlineType)}
        disabled={isExporting}
      >
        {isExporting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            <Download className="h-3 w-3 mr-1" />
            Export
          </>
        )}
      </Button>
    );
  }

  // Batch variant - dropdown with options
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={buttonVariant} size={size} disabled={isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export All
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export to Calendar</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={() => exportCalendar('all')}>
          <Calendar className="h-4 w-4 mr-2" />
          All Deadlines
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => exportCalendar('submission')}>
          <Calendar className="h-4 w-4 mr-2" />
          Submission Deadlines Only
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}