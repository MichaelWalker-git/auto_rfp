'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function OrganizationPage() {
  const router = useRouter();
  const pathname = usePathname(); // e.g. "/org/123" or "/current"

  useEffect(() => {
    if (!pathname) return;

    // Ensure no trailing slash
    const base = pathname.replace(/\/$/, '');
    router.replace(`${base}/projects`);
  }, [pathname, router]);

  return null;
}
