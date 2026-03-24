---
name: frontend-form
description: Create a form page with react-hook-form, Zod validation, Shadcn UI inputs, and proper create/edit patterns
---

# Frontend Form Creation

When creating a form (create or edit page) in this project, follow these exact steps:

## 1. Create Page

Create `apps/web/app/(dashboard)/<feature>/create/page.tsx`:

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Create<Feature>Schema } from '@auto-rfp/core';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useCreate<Feature> } from '@/features/<feature>';
import { useCurrentOrganization } from '@/context/organization-context';
import { toast } from 'sonner';

type FormValues = z.input<typeof Create<Feature>Schema>;

const Create<Feature>Page = () => {
  const router = useRouter();
  const { organization } = useCurrentOrganization();
  const { create<Feature>, isSubmitting } = useCreate<Feature>();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Create<Feature>Schema),
    defaultValues: {
      orgId: organization?.id ?? '',
    },
  });

  const onSubmit = async (data: FormValues) => {
    try {
      await create<Feature>(data);
      toast.success('<Feature> created successfully');
      router.push('/<feature>');
    } catch {
      toast.error('Failed to create <feature>');
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/<feature>"><Features></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>Create</BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader title="Create <Feature>" />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                id="name"
                {...register('name')}
                placeholder="Enter name"
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium text-foreground">
                Description
              </label>
              <Input
                id="description"
                {...register('description')}
                placeholder="Enter description (optional)"
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/<feature>')}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Create<Feature>Page;
```

## 2. Edit Page Pattern

Create `apps/web/app/(dashboard)/<feature>/[id]/edit/page.tsx`:

- Same form structure but pre-populate with existing data via SWR
- Use `useForm({ defaultValues })` with fetched data
- Use `reset()` when data loads: `useEffect(() => { if (data) reset(data); }, [data, reset]);`
- Submit calls update endpoint instead of create

## 3. Form with Select/Dropdown

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Controller } from 'react-hook-form';

<Controller
  name="status"
  control={control}
  render={({ field }) => (
    <Select onValueChange={field.onChange} value={field.value}>
      <SelectTrigger>
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="inactive">Inactive</SelectItem>
      </SelectContent>
    </Select>
  )}
/>
```

## 4. Hard Rules

- **Use `z.input<typeof Schema>`** as form type — handles `.default()` fields correctly
- **Use `zodResolver(Schema)`** for validation — never manual validation
- **No manual `useState` for form fields** — use `register()` from react-hook-form
- **Use `Controller` for non-native inputs** (Select, Switch, DatePicker)
- **Create/Edit MUST be separate pages** — never inline forms or use modals
- **Use Shadcn UI components** — `Input`, `Select`, `Button`, `Card`
- **Error messages use `text-destructive`** — never hardcoded red colors
- **Labels use `text-foreground`** — never hardcoded text colors
- **Toast notifications** via `sonner` for success/error feedback
- **Breadcrumb navigation** on all create/edit pages
- **Use `const` arrow functions** — never `function` keyword
