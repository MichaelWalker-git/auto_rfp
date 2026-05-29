import React, { Suspense } from "react";
import { SettingsContent } from "@/components/organizations/SettingsContent";
import { PageSkeleton } from "@/components/projects/PageSkeleton";

interface SettingsPageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { orgId } = await params;
  
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsContent orgId={orgId} />
    </Suspense>
  );
} 