'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, Search, Settings2 } from 'lucide-react';
import { ClusteringSettings } from '@/components/organizations/ClusteringSettings';
import { PrimaryContactCard } from '@/components/organizations/PrimaryContactCard';
import { PermissionButton } from '@/components/ui/permission-button';

interface OrganizationConfigurationLinksProps {
  orgId: string;
}

export const OrganizationConfigurationLinks: React.FC<OrganizationConfigurationLinksProps> = ({ orgId }) => {
  const router = useRouter();

  return (
    <>
      {/* Prompts Management Link */}
      <PermissionButton
        requiredPermission="org:manage_settings"
        variant="ghost"
        className="w-full p-0 h-auto justify-start hover:bg-transparent"
        onClick={() => router.push(`/organizations/${orgId}/settings/prompts`)}
      >
        <Card className="w-full hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1 text-left">
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Prompts
              </CardTitle>
              <CardDescription>
                Manage system and user prompts for AI-powered features
              </CardDescription>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
        </Card>
      </PermissionButton>

      {/* Semantic Search Tester Link */}
      <Card className="hover:border-primary/50 transition-colors">
        <Link href={`/organizations/${orgId}/settings/semantic-search`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Semantic Search Tester
              </CardTitle>
              <CardDescription>
                Test how semantic search retrieves content from Org Documents, Q&amp;A Library, and Past Performance
              </CardDescription>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
        </Link>
      </Card>

      {/* Question Clustering Settings */}
      <ClusteringSettings orgId={orgId} />

      {/* Primary Contact (Proposal Signatory) */}
      <PrimaryContactCard orgId={orgId} />
    </>
  );
};
