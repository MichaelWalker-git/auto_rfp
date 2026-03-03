'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Mail, MapPin, Phone, Trash2, User, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  useOrgPrimaryContact,
  upsertOrgPrimaryContactApi,
  deleteOrgPrimaryContactApi,
} from '@/lib/hooks/use-org-contact';

// ─── Form schema ──────────────────────────────────────────────────────────────

const ContactFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  title: z.string().trim().min(1, 'Title is required'),
  email: z.string().email('Must be a valid email'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

type ContactFormValues = z.input<typeof ContactFormSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface PrimaryContactCardProps {
  orgId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PrimaryContactCard = ({ orgId }: PrimaryContactCardProps) => {
  const { toast } = useToast();
  const { data, isLoading, error, mutate } = useOrgPrimaryContact(orgId);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 404 = no contact exists yet — treat as empty (not an error state)
  const is404 = error?.status === 404;
  const contact = data?.contact;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isValid },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(ContactFormSchema),
    defaultValues: {
      name: '',
      title: '',
      email: '',
      phone: '',
      address: '',
    },
    values: contact
      ? {
          name: contact.name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone ?? '',
          address: contact.address ?? '',
        }
      : undefined,
  });

  const onSubmit = async (values: ContactFormValues) => {
    try {
      setIsSaving(true);
      await upsertOrgPrimaryContactApi(orgId, {
        name: values.name,
        title: values.title,
        email: values.email,
        phone: values.phone || undefined,
        address: values.address || undefined,
      });
      await mutate();
      reset(values);
      toast({ title: 'Primary contact saved', description: 'The proposal signatory has been updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save primary contact.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteOrgPrimaryContactApi(orgId);
      await mutate();
      reset({ name: '', title: '', email: '', phone: '', address: '' });
      toast({ title: 'Primary contact removed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove primary contact.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading && !is404) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
              <UserCheck className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <CardTitle className="text-base">Primary Contact</CardTitle>
              <CardDescription className="text-xs mt-0.5">Proposal Signatory</CardDescription>
            </div>
          </div>
          {contact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          The executive who signs proposals — used in Cover Letters, Commitment Statements, and all
          documents requiring a signature block.
        </p>
      </CardHeader>

      <Separator />

      <form onSubmit={handleSubmit(onSubmit)} id="primary-contact-form">
        <CardContent className="pt-5 space-y-4">
          {/* Name + Title */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Full Name <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="contact-name"
                  className="pl-9 h-9 text-sm"
                  placeholder="Jane Smith"
                  {...register('name')}
                />
              </div>
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-title" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Title / Position <span className="text-destructive">*</span>
              </Label>
              <Input
                id="contact-title"
                className="h-9 text-sm"
                placeholder="Vice President, Contracts"
                {...register('title')}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Email <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="contact-email"
                  type="email"
                  className="pl-9 h-9 text-sm"
                  placeholder="jsmith@company.com"
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-phone" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Phone
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="contact-phone"
                  type="tel"
                  className="pl-9 h-9 text-sm"
                  placeholder="(202) 555-0100"
                  {...register('phone')}
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-address" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Address
            </Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="contact-address"
                className="pl-9 h-9 text-sm"
                placeholder="1234 K Street NW, Washington DC 20005"
                {...register('address')}
              />
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || (!isDirty && !isValid)}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Contact'
              )}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
};
