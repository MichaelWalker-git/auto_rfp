import { z } from "zod";

export const StoredApiKeySchema = z.object({
  pk: z.string(),
  sk: z.string(),
  encryptedKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StoredApiKey = z.infer<typeof StoredApiKeySchema>;

export const API_KEY_PARTITION_KEY = "SAM_GOV_API_KEY";

export const ApiKeyRequestSchema = z.object({
  apiKey: z.string().min(1).max(10000),
});

export type ApiKeyRequest = z.infer<typeof ApiKeyRequestSchema>;

export const ApiKeyResponseSchema = z.object({
  message: z.string(),
  orgId: z.string(),
});

export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;