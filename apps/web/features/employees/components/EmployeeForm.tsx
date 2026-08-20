'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmployeeCreateRequestSchema } from '@auto-rfp/core';
import type { EmployeeItem } from '@auto-rfp/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RoleTagInput } from './RoleTagInput';

/** The form edits every field except the org identifier (BR3.2). */
const EmployeeFormSchema = EmployeeCreateRequestSchema.omit({ orgId: true });

export type EmployeeFormValues = z.input<typeof EmployeeFormSchema>;
export type EmployeeFormOutput = z.output<typeof EmployeeFormSchema>;

const LOCATION_NONE = 'NONE' as const;

export interface EmployeeFormProps {
  /** Pre-filled values when editing; empty for create (W2/W3). */
  initialEmployee?: EmployeeItem;
  /** Role typing suggestions from labor-rate positions (BR1.5). */
  roleSuggestions: string[];
  onSubmit: (values: EmployeeFormOutput) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  /** Server-side field errors (field path → message), merged below the fields (BR4.3). */
  serverErrors?: Partial<Record<keyof EmployeeFormValues, string>>;
}

const FieldError = ({ id, message }: { id: string; message?: string }) => {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive" data-testid={id} role="alert">
      {message}
    </p>
  );
};

/**
 * Full-record create/edit form (BR4.3). Validation mirrors BR1.1–BR1.4
 * client-side for immediate feedback; the server remains authoritative.
 * Entered data is preserved on failure — react-hook-form keeps field state.
 */
export const EmployeeForm = ({
  initialEmployee,
  roleSuggestions,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
  serverErrors,
}: EmployeeFormProps) => {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(EmployeeFormSchema),
    defaultValues: {
      name: initialEmployee?.name ?? '',
      primaryRoles: initialEmployee?.primaryRoles ?? [],
      secondaryRoles: initialEmployee?.secondaryRoles ?? [],
      certifications: initialEmployee?.certifications ?? [],
      resumeRef: initialEmployee?.resumeRef,
      location: initialEmployee?.location,
    },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit(EmployeeFormSchema.parse(values));
  });

  return (
    <form onSubmit={submit} className="space-y-6" data-testid="employee-form" noValidate>
      <div className="space-y-2">
        <Label htmlFor="employee-name">Name</Label>
        <Input
          id="employee-name"
          data-testid="employee-form-name"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'employee-form-name-error' : undefined}
          {...register('name')}
        />
        <FieldError id="employee-form-name-error" message={errors.name?.message ?? serverErrors?.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="employee-primary-roles">Primary roles</Label>
        <Controller
          control={control}
          name="primaryRoles"
          render={({ field }) => (
            <RoleTagInput
              id="employee-primary-roles"
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={roleSuggestions}
              placeholder="e.g. Project Manager — type and press Enter"
              data-testid="employee-form-primary-roles"
            />
          )}
        />
        <FieldError
          id="employee-form-primary-roles-error"
          message={errors.primaryRoles?.message ?? serverErrors?.primaryRoles}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="employee-secondary-roles">Secondary roles</Label>
        <Controller
          control={control}
          name="secondaryRoles"
          render={({ field }) => (
            <RoleTagInput
              id="employee-secondary-roles"
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={roleSuggestions}
              placeholder="e.g. Scrum Master — type and press Enter"
              data-testid="employee-form-secondary-roles"
            />
          )}
        />
        <FieldError
          id="employee-form-secondary-roles-error"
          message={errors.secondaryRoles?.message ?? serverErrors?.secondaryRoles}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="employee-certifications">Certifications</Label>
        <Controller
          control={control}
          name="certifications"
          render={({ field }) => (
            <RoleTagInput
              id="employee-certifications"
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={[]}
              maxEntryLength={200}
              placeholder="e.g. PMP — type and press Enter"
              data-testid="employee-form-certifications"
            />
          )}
        />
        <FieldError
          id="employee-form-certifications-error"
          message={errors.certifications?.message ?? serverErrors?.certifications}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="employee-resume-ref">Resume / bio reference</Label>
        <Input
          id="employee-resume-ref"
          data-testid="employee-form-resume-ref"
          placeholder="Org document id or an external link"
          aria-invalid={!!errors.resumeRef}
          {...register('resumeRef', {
            setValueAs: (v: string) => (v?.trim() ? v.trim() : undefined),
          })}
        />
        <FieldError
          id="employee-form-resume-ref-error"
          message={errors.resumeRef?.message ?? serverErrors?.resumeRef}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">Location</legend>
        <Controller
          control={control}
          name="location"
          render={({ field }) => (
            <RadioGroup
              value={field.value ?? LOCATION_NONE}
              onValueChange={(next) => field.onChange(next === LOCATION_NONE ? undefined : next)}
              className="flex flex-wrap gap-4"
              data-testid="employee-form-location"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value={LOCATION_NONE} id="employee-location-none" />
                <Label htmlFor="employee-location-none" className="font-normal">
                  Not specified
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="ONSHORE" id="employee-location-onshore" />
                <Label htmlFor="employee-location-onshore" className="font-normal">
                  Onshore
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="OFFSHORE" id="employee-location-offshore" />
                <Label htmlFor="employee-location-offshore" className="font-normal">
                  Offshore
                </Label>
              </div>
            </RadioGroup>
          )}
        />
        <FieldError
          id="employee-form-location-error"
          message={errors.location?.message ?? serverErrors?.location}
        />
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} data-testid="employee-form-submit">
          {submitLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          data-testid="employee-form-cancel"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
};
