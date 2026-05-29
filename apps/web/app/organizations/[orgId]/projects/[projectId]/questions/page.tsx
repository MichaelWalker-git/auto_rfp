import React, { Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/toaster';

import { QuestionsSection } from './components';

function QuestionsLoadingFallback() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-white">
        <div className="container flex h-16 p-4 items-center">
          <div className="font-bold text-xl">AutoRFP</div>
        </div>
      </header>
      <main className="flex-1 bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" className="mb-4"/>
          <p className="text-lg">Loading...</p>
        </div>
      </main>
    </div>
  );
}

type Props = { params: Promise<{ projectId: string, orgId: string }> }

export default async function QuestionsPage({ params }: Props) {
  const { projectId, orgId } = await params;

  return (

    <Suspense fallback={<QuestionsLoadingFallback/>}>
      <QuestionsSection orgId={orgId} projectId={projectId}/>
      <Toaster/>
    </Suspense>

  );
}