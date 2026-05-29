import React, { Suspense } from "react";
import { TeamContent } from "@/components/organizations/TeamContent";
import { PageSkeleton } from "@/components/projects/PageSkeleton";

interface TeamPageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { orgId } = await params;
  
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TeamContent orgId={orgId} />
    </Suspense>
  );
} 