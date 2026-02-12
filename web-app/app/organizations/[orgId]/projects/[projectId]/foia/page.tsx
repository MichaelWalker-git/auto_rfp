'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * FOIA Requests are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
export default function FOIAPage() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const base = pathname.replace(/\/foia\/?$/, '');
    router.replace(`${base}/opportunities`);
  }, [pathname, router]);

  return null;
}