'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProfile, editProfileApi } from '@/lib/hooks/use-profile';
import { useToast } from '@/components/ui/use-toast';
import { NotificationPreferencesForm } from '@/features/notifications';
import { useCurrentOrganization } from '@/context/organization-context';

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileEditDialog({ open, onOpenChange }: ProfileEditDialogProps) {
  const { profile, mutate } = useProfile();
  const { currentOrganization } = useCurrentOrganization();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile && open) {
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
      setDisplayName(profile.displayName ?? '');
      setPhone(profile.phone ?? '');
    }
  }, [profile, open]);

  const handleSave = async () => {
    if (!profile?.orgId || !profile?.userId) return;
    setIsSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      if (displayName.trim()) payload.displayName = displayName.trim();
      if (phone.trim()) payload.phone = phone.trim();
      await editProfileApi(profile.orgId, profile.userId, payload);
      await mutate();
      toast({ title: 'Profile updated', description: 'Your profile has been saved.' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Update failed', description: err.message || 'Failed to update profile', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const orgId = currentOrganization?.id ?? profile?.orgId ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Use default DialogContent padding (p-6) — keeps close button working */}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
          <DialogDescription>
            Manage your personal information and notification preferences.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="profile">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          {/* ── Profile tab ── */}
          <TabsContent value="profile">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profile?.email ?? ''}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-firstName">First Name</Label>
                  <Input
                    id="profile-firstName"
                    placeholder="John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-lastName">Last Name</Label>
                  <Input
                    id="profile-lastName"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="profile-displayName">Display Name</Label>
                <Input
                  id="profile-displayName"
                  placeholder="How you want to appear"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. If empty, your first and last name will be used.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </TabsContent>

          {/* ── Notifications tab ── */}
          <TabsContent value="notifications">
            <div className="py-4 max-h-[60vh] overflow-y-auto pr-1">
              {orgId ? (
                <NotificationPreferencesForm orgId={orgId} />
              ) : (
                <p className="text-sm text-slate-500">
                  Select an organization to manage notification preferences.
                </p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
