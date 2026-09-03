import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AI_NOT_CONFIGURED_DESCRIPTION,
  AI_NOT_CONFIGURED_TITLE,
} from '@/lib/ai-not-configured';

interface AiNotConfiguredNoticeProps {
  /** Org whose integration settings the admin should open. */
  orgId: string;
  /** Optional override for the body copy (defaults to the shared description). */
  description?: string;
  className?: string;
}

/**
 * Shared, presentation-only "AI is not configured" state.
 *
 * Rendered by every AI surface when the org has no valid Bedrock key, pointing
 * an admin at the Bedrock settings card instead of showing a generic error.
 */
export const AiNotConfiguredNotice = ({
  orgId,
  description = AI_NOT_CONFIGURED_DESCRIPTION,
  className,
}: AiNotConfiguredNoticeProps) => (
  <Alert variant="destructive" className={cn('space-y-2', className)}>
    <AlertTriangle className="h-4 w-4" />
    <AlertTitle>{AI_NOT_CONFIGURED_TITLE}</AlertTitle>
    <AlertDescription>
      <p>{description}</p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href={`/organizations/${orgId}/settings`}>Go to integration settings</Link>
      </Button>
    </AlertDescription>
  </Alert>
);
