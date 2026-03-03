'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import DeadlinesDashboard from '@/components/deadlines/DeadlinesDashboard';
import { useCurrentOrganization } from '@/context/organization-context';

export default function AllDeadlinesPage () {
  const { currentOrganization } = useCurrentOrganization();
  
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">AutoRFP Deadlines Tracking Center</h1>
              <p className="text-muted-foreground mt-2">
                Check deadline dates for all your projects in one place.
              </p>
            </div>
            <Link href="/">
              <Button variant="outline">Back to App</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <DeadlinesDashboard 
          orgId={currentOrganization?.id}
          showFilters={true}
        />
      </div>
    </div>    
    
  )
}
