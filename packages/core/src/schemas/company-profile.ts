import { z } from 'zod';

// ─── Company Profile Field Schema ───

export const CompanyProfileFieldCategorySchema = z.enum([
  'IDENTITY',
  'CONTACT',
  'REGISTRATION',
  'CERTIFICATION',
  'INSURANCE',
  'CAPABILITY',
]);

export type CompanyProfileFieldCategory = z.infer<typeof CompanyProfileFieldCategorySchema>;

export const CompanyProfileFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  category: CompanyProfileFieldCategorySchema,
  verified: z.boolean().default(false),
  verifiedAt: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export type CompanyProfileField = z.infer<typeof CompanyProfileFieldSchema>;

// ─── Company Profile Item ───

export const CompanyProfileItemSchema = z.object({
  orgId: z.string(),
  companyName: z.string(),
  legalEntityName: z.string().nullable().default(null),
  dba: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  state: z.string().nullable().default(null),
  zip: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  ein: z.string().nullable().default(null),
  uei: z.string().nullable().default(null),
  cage: z.string().nullable().default(null),
  primaryNaics: z.string().nullable().default(null),
  secondaryNaics: z.array(z.string()).default([]),
  entityType: z.string().nullable().default(null),
  stateEntityNumber: z.string().nullable().default(null),
  smallBusinessCertId: z.string().nullable().default(null),
  smallBusinessCertExpiration: z.string().nullable().default(null),
  fields: z.array(CompanyProfileFieldSchema).default([]),
  authorizedSignatory: z.object({
    name: z.string(),
    title: z.string(),
    email: z.string().optional(),
  }).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CompanyProfileItem = z.infer<typeof CompanyProfileItemSchema>;

// ─── Create DTO ───

export const CreateCompanyProfileDTOSchema = z.object({
  orgId: z.string().min(1),
  companyName: z.string().min(1),
  legalEntityName: z.string().nullable().optional(),
  dba: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  ein: z.string().nullable().optional(),
  uei: z.string().nullable().optional(),
  cage: z.string().nullable().optional(),
  primaryNaics: z.string().nullable().optional(),
  secondaryNaics: z.array(z.string()).optional(),
  entityType: z.string().nullable().optional(),
  stateEntityNumber: z.string().nullable().optional(),
  smallBusinessCertId: z.string().nullable().optional(),
  smallBusinessCertExpiration: z.string().nullable().optional(),
  fields: z.array(CompanyProfileFieldSchema).optional(),
  authorizedSignatory: z.object({
    name: z.string(),
    title: z.string(),
    email: z.string().optional(),
  }).nullable().optional(),
});

export type CreateCompanyProfileDTO = z.infer<typeof CreateCompanyProfileDTOSchema>;

// ─── Update DTO ───

export const UpdateCompanyProfileDTOSchema = CreateCompanyProfileDTOSchema.omit({ orgId: true }).partial();

export type UpdateCompanyProfileDTO = z.infer<typeof UpdateCompanyProfileDTOSchema>;

// ─── API Responses ───

export const CompanyProfileResponseSchema = z.object({
  profile: CompanyProfileItemSchema,
});

export type CompanyProfileResponse = z.infer<typeof CompanyProfileResponseSchema>;
