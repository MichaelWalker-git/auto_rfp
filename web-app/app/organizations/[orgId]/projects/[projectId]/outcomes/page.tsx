'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Project Outcomes are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
export default function OutcomesPage() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const base = pathname.replace(/\/outcomes\/?$/, '');
    router.replace(`${base}/opportunities`);
  }, [pathname, router]);

  return null;
}