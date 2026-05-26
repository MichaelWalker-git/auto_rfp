'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateCompanyProfileDTOSchema, type CreateCompanyProfileDTO } from '@auto-rfp/core';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useCompanyProfile } from '../hooks/useCompanyProfile';
import { useUpsertCompanyProfile } from '../hooks/useUpsertCompanyProfile';
import { Save, Building2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type FormValues = z.input<typeof CreateCompanyProfileDTOSchema>;

interface CompanyProfileFormProps {
  orgId: string;
}

export const CompanyProfileForm = ({ orgId }: CompanyProfileFormProps) => {
  const { toast } = useToast();
  const { profile, isLoading, mutate } = useCompanyProfile(orgId);
  const { upsertProfile } = useUpsertCompanyProfile();

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(CreateCompanyProfileDTOSchema),
    values: {
      orgId,
      companyName: profile?.companyName ?? '',
      legalEntityName: profile?.legalEntityName ?? null,
      dba: profile?.dba ?? null,
      address: profile?.address ?? null,
      city: profile?.city ?? null,
      state: profile?.state ?? null,
      zip: profile?.zip ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      website: profile?.website ?? null,
      ein: profile?.ein ?? null,
      uei: profile?.uei ?? null,
      cage: profile?.cage ?? null,
      primaryNaics: profile?.primaryNaics ?? null,
      entityType: profile?.entityType ?? null,
      stateEntityNumber: profile?.stateEntityNumber ?? null,
      smallBusinessCertId: profile?.smallBusinessCertId ?? null,
      smallBusinessCertExpiration: profile?.smallBusinessCertExpiration ?? null,
    },
  });

  const handleSave = async (data: FormValues) => {
    try {
      await upsertProfile(data as CreateCompanyProfileDTO);
      await mutate();
      toast({ title: 'Company profile saved' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save profile',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Company Profile
        </CardTitle>
        <CardDescription>
          Company registration data used to auto-fill required vendor forms.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name *</Label>
              <Input id="companyName" {...register('companyName')} placeholder="Acme Corp DBA Acme Tech" />
              {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="legalEntityName">Legal Entity Name</Label>
              <Input id="legalEntityName" {...register('legalEntityName')} placeholder="Acme Corp LLC" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dba">DBA / Trade Name</Label>
              <Input id="dba" {...register('dba')} placeholder="Acme Technology" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityType">Entity Type</Label>
              <Input id="entityType" {...register('entityType')} placeholder="LLC, Corp, etc." />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...register('address')} placeholder="123 Main St" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...register('city')} placeholder="San Diego" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" {...register('state')} placeholder="CA" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">Zip</Label>
                <Input id="zip" {...register('zip')} placeholder="92117" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register('phone')} placeholder="(555) 123-4567" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" {...register('email')} placeholder="proposals@company.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" {...register('website')} placeholder="www.company.com" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ein">EIN / Federal Tax ID</Label>
              <Input id="ein" {...register('ein')} placeholder="12-3456789" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uei">UEI</Label>
              <Input id="uei" {...register('uei')} placeholder="RNACJ2JYTZ43" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cage">CAGE Code</Label>
              <Input id="cage" {...register('cage')} placeholder="1ABC2" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="primaryNaics">Primary NAICS</Label>
              <Input id="primaryNaics" {...register('primaryNaics')} placeholder="541511" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stateEntityNumber">State Entity No.</Label>
              <Input id="stateEntityNumber" {...register('stateEntityNumber')} placeholder="3837112" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smallBusinessCertId">Small Business Cert ID</Label>
              <Input id="smallBusinessCertId" {...register('smallBusinessCertId')} placeholder="2043901" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smallBusinessCertExpiration">SB Cert Expiration</Label>
              <Input id="smallBusinessCertExpiration" {...register('smallBusinessCertExpiration')} placeholder="02/28/2027" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting || !isDirty} className="gap-2">
              <Save className="h-4 w-4" />
              {isSubmitting ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
