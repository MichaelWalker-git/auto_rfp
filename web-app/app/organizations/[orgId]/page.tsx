'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function OrganizationPage() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    const base = pathname.replace(/\/$/, '');
    router.replace(`${base}/projects`);
  }, [pathname, router]);

  return null;
}
