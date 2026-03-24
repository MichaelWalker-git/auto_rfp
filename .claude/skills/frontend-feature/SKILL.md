---
name: frontend-feature
description: Create a new frontend feature module with hooks, components, and pages following Feature-Sliced Design in Next.js App Router
---

# Frontend Feature Module Creation

When creating a new frontend feature in this project, follow these exact steps:

## 1. Directory Structure

Create the feature module under `apps/web/features/<feature>/`:

```
features/<feature>/
├── components/           # Presentation-only components
│   ├── <Feature>List.tsx
│   ├── <Feature>Card.tsx
│   └── <Feature>Form.tsx
├── hooks/                # Feature-specific logic hooks
│   ├── use<Feature>s.ts
│   ├── useCreate<Feature>.ts
│   └── useEdit<Feature>.ts
├── lib/                  # Helper functions and utilities
│   ├── validation.ts
│   └── formatting.ts
├── types.ts              # Local UI-specific types only
└── index.ts              # Barrel export
```

## 2. Data Fetching Hook

Create `apps/web/features/<feature>/hooks/use<Feature>s.ts`:

```typescript
'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/api';
import type { <Feature>Item } from '@auto-rfp/core';

export const use<Feature>s = (orgId: string | undefined) => {
  const { data, error, isLoading, mutate } = useSWR<{ items: <Feature>Item[] }>(
    orgId ? `/<feature>/list?orgId=${orgId}` : null,
    authenticatedFetcher,
  );

  return {
    <feature>s: data?.items ?? [],
    error,
    isLoading,
    mutate,
  };
};
```

## 3. Mutation Hook

Create `apps/web/features/<feature>/hooks/useCreate<Feature>.ts`:

```typescript
'use client';

import { useCallback, useState } from 'react';
import { apiMutate } from '@/lib/api';
import type { Create<Feature>DTO } from '@auto-rfp/core';

export const useCreate<Feature> = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create<Feature> = useCallback(async (dto: Create<Feature>DTO) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await apiMutate('/<feature>/create', {
        method: 'POST',
        body: dto,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create <feature>';
      setError(message);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { create<Feature>, isSubmitting, error };
};
```

## 4. Presentation Component

Create `apps/web/features/<feature>/components/<Feature>List.tsx`:

```typescript
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { <Feature>Item } from '@auto-rfp/core';

interface <Feature>ListProps {
  items: <Feature>Item[];
  isLoading: boolean;
  onSelect?: (item: <Feature>Item) => void;
}

export const <Feature>List = ({ items, isLoading, onSelect }: <Feature>ListProps) => {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No items found. Create your first one to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card
          key={item.id}
          className="cursor-pointer hover:bg-accent transition-colors"
          onClick={() => onSelect?.(item)}
        >
          <CardHeader>
            <CardTitle className="text-foreground">{item.name}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
};
```

## 5. Barrel Export

Create `apps/web/features/<feature>/index.ts`:

```typescript
export { <Feature>List } from './components/<Feature>List';
export { use<Feature>s } from './hooks/use<Feature>s';
export { useCreate<Feature> } from './hooks/useCreate<Feature>';
```

## 6. Page Component

Create `apps/web/app/(dashboard)/<feature>/page.tsx`:

```typescript
'use client';

import { <Feature>List, use<Feature>s } from '@/features/<feature>';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCurrentOrganization } from '@/context/organization-context';

const <Feature>Page = () => {
  const { organization } = useCurrentOrganization();
  const { <feature>s, isLoading } = use<Feature>s(organization?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="<Features>"
        action={
          <Button asChild>
            <Link href="/<feature>/create">
              <Plus className="mr-2 h-4 w-4" /> Create
            </Link>
          </Button>
        }
      />
      <<Feature>List items={<feature>s} isLoading={isLoading} />
    </div>
  );
};

export default <Feature>Page;
```

## 7. Loading Skeleton

Create `apps/web/app/(dashboard)/<feature>/loading.tsx`:

```typescript
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

const Loading = () => <PageLoadingSkeleton variant="list" />;

export default Loading;
```

## 8. Hard Rules

- **Components are pure presentation** — no API calls, no business logic, no routing
- **Logic lives in hooks** — data fetching, mutations, state management
- **Use Shadcn UI components** — never raw HTML elements for buttons, inputs, cards
- **Use design tokens for dark mode** — `bg-card`, `text-foreground`, `text-muted-foreground`, `hover:bg-accent`
- **Never use hardcoded colors** — no `bg-white`, `text-gray-500`, `border-gray-200`
- **Loading states use `<Skeleton>`** — never spinners or "Loading..." text
- **Types from `@auto-rfp/core`** — only define local types for UI-specific concerns
- **Forms use react-hook-form + zodResolver** — no manual `useState` for form fields
- **Create/Edit are separate pages** — never inline forms in list pages
- **Barrel exports** — pages import from `@/features/<feature>`, never internal paths
- **Use `const` arrow functions** — never `function` keyword (except `export default function` for Next.js pages if required)
