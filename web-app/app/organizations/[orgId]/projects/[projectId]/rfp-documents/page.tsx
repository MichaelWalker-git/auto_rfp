'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * RFP Documents are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
export default function RFPDocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // Navigate to the opportunities page within the same project
    const base = pathname.replace(/\/rfp-documents\/?$/, '');
    router.replace(`${base}/opportunities`);
  }, [pathname, router]);

  return null;
}