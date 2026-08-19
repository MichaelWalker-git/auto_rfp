'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Mail, Loader2, Trash2, Plus, AlertTriangle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { PermissionButton } from '@/components/ui/permission-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  useFoiaAgencyContacts,
  useUpsertFoiaAgencyContact,
  useDeleteFoiaAgencyContact,
} from '@/lib/hooks/use-foia-settings';
import { FoiaAgencyContactCreateRequestSchema, type FoiaAgencyContactItem } from '@auto-rfp/core';
import { z } from 'zod';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaAgencyContactsCardProps {
  orgId: string;
}

type FoiaAgencyContactFormValues = z.input<typeof FoiaAgencyContactCreateRequestSchema>;

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaAgencyContactsCard = ({ orgId }: FoiaAgencyContactsCardProps) => {
  const { toast } = useToast();
  const { contacts, isLoading, mutate } = useFoiaAgencyContacts(orgId);
  const { upsertContact, isSaving } = useUpsertFoiaAgencyContact();
  const { deleteContact, isDeleting } = useDeleteFoiaAgencyContact();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteDialogContact, setDeleteDialogContact] = useState<FoiaAgencyContactItem | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<FoiaAgencyContactFormValues>({
    resolver: zodResolver(FoiaAgencyContactCreateRequestSchema),
    mode: 'onChange',
    defaultValues: {
      orgId,
      agencyName: '',
      foiaEmail: undefined,
      foiaAddress: undefined,
      acceptsEmail: true,
      webPortalUrl: undefined,
      notes: undefined,
    },
  });

  const onSubmit = async (values: FoiaAgencyContactFormValues) => {
    try {
      // Ensure acceptsEmail has a boolean value (default to true)
      const payload = {
        ...values,
        acceptsEmail: values.acceptsEmail ?? true,
      };
      await upsertContact(payload);
      await mutate();
      reset({ orgId, agencyName: '', foiaEmail: undefined, foiaAddress: undefined, acceptsEmail: true });
      setIsFormOpen(false);
      toast({ title: 'Agency contact saved', description: 'The contact has been added to your directory.' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save agency contact',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (contact: FoiaAgencyContactItem) => {
    try {
      await deleteContact(orgId, contact.agencyKey);
      await mutate();
      setDeleteDialogContact(null);
      toast({ title: 'Agency contact removed', description: `${contact.agencyName} has been deleted.` });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete agency contact',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <CardTitle className="text-base">FOIA Agency Contacts</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Saved FOIA office contacts for reuse
                </CardDescription>
              </div>
            </div>
            <PermissionButton
              requiredPermission="org:manage_settings"
              variant="outline"
              size="sm"
              onClick={() => setIsFormOpen(!isFormOpen)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Contact
            </PermissionButton>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="pt-5 space-y-4">
          {/* Add/Edit form */}
          {isFormOpen && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-4 border rounded-md bg-muted/20">
              <div className="space-y-1.5">
                <Label htmlFor="agency-name" className="text-xs">
                  Agency Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="agency-name"
                  placeholder="Department of Defense"
                  className="h-9 text-sm"
                  {...register('agencyName')}
                />
                {errors.agencyName && <p className="text-xs text-destructive">{errors.agencyName.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="foia-email" className="text-xs">
                    FOIA Email
                  </Label>
                  <Input
                    id="foia-email"
                    type="email"
                    placeholder="foia@agency.gov"
                    className="h-9 text-sm"
                    {...register('foiaEmail')}
                  />
                  {errors.foiaEmail && <p className="text-xs text-destructive">{errors.foiaEmail.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="foia-address" className="text-xs">
                    FOIA Mailing Address
                  </Label>
                  <Input
                    id="foia-address"
                    placeholder="123 Main St, Washington DC 20001"
                    className="h-9 text-sm"
                    {...register('foiaAddress')}
                  />
                  {errors.foiaAddress && <p className="text-xs text-destructive">{errors.foiaAddress.message}</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="web-portal-url" className="text-xs">
                  Web Portal URL
                </Label>
                <Input
                  id="web-portal-url"
                  type="url"
                  placeholder="https://foia.agency.gov"
                  className="h-9 text-sm"
                  {...register('webPortalUrl')}
                />
                {errors.webPortalUrl && <p className="text-xs text-destructive">{errors.webPortalUrl.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">
                  Notes
                </Label>
                <Input
                  id="notes"
                  placeholder="Additional information..."
                  className="h-9 text-sm"
                  {...register('notes')}
                />
                {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" size="sm" disabled={isSaving || !isValid}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : 'Save Contact'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Contacts list */}
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No agency contacts saved yet.
            </p>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div key={contact.agencyKey} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="text-sm font-medium">{contact.agencyName}</p>
                      </div>

                      {contact.foiaEmail && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span>{contact.foiaEmail}</span>
                        </div>
                      )}

                      {contact.webPortalUrl && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <a
                            href={contact.webPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {contact.webPortalUrl}
                          </a>
                        </div>
                      )}

                      {contact.verifiedAt && (
                        <p className="text-xs text-muted-foreground">
                          Verified {format(new Date(contact.verifiedAt), 'MMM d, yyyy')}
                        </p>
                      )}

                      {contact.acceptsEmail === false && contact.lastBounceReason && (
                        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>Email bounced: {contact.lastBounceReason}</span>
                        </div>
                      )}
                    </div>

                    <PermissionButton
                      requiredPermission="org:manage_settings"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteDialogContact(contact)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </PermissionButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteDialogContact}
        onOpenChange={(open) => !open && setDeleteDialogContact(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agency contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{' '}
              <span className="font-medium">{deleteDialogContact?.agencyName}</span> from your
              directory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteDialogContact) handleDelete(deleteDialogContact);
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
