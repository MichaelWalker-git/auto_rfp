import { invokeModel } from './bedrock-http-client';
import { safeParseJsonFromModel } from './json';
import { requireEnv } from './env';

import type { DetectedFormField, CompanyProfileItem } from '@auto-rfp/core';

const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

const ALWAYS_MANUAL_PATTERNS = [
  /signature/i,
  /sign\s*here/i,
  /authorized\s*sign/i,
  /notary/i,
  /witness/i,
  /contract\s*no/i,
  /contract\s*number/i,
  /project\s*name/i,
  /project\s*number/i,
  /policy\s*number/i,
  /insurer/i,
  /insurance.*expir/i,
];

const CONFIDENCE_THRESHOLD = 0.7;

type MatchResult = {
  fieldId: string;
  profileFieldKey: string | null;
  value: string | null;
  confidence: number;
  manualReason: string | null;
};

const buildProfileContext = (profile: CompanyProfileItem): string => {
  const entries: string[] = [];
  if (profile.companyName) entries.push(`companyName: ${profile.companyName}`);
  if (profile.legalEntityName) entries.push(`legalEntityName: ${profile.legalEntityName}`);
  if (profile.dba) entries.push(`dba: ${profile.dba}`);
  if (profile.address) entries.push(`address: ${profile.address}`);
  if (profile.city) entries.push(`city: ${profile.city}`);
  if (profile.state) entries.push(`state: ${profile.state}`);
  if (profile.zip) entries.push(`zip: ${profile.zip}`);
  if (profile.phone) entries.push(`phone: ${profile.phone}`);
  if (profile.email) entries.push(`email: ${profile.email}`);
  if (profile.website) entries.push(`website: ${profile.website}`);
  if (profile.ein) entries.push(`ein: ${profile.ein}`);
  if (profile.uei) entries.push(`uei: ${profile.uei}`);
  if (profile.cage) entries.push(`cage: ${profile.cage}`);
  if (profile.primaryNaics) entries.push(`primaryNaics: ${profile.primaryNaics}`);
  if (profile.stateEntityNumber) entries.push(`stateEntityNumber: ${profile.stateEntityNumber}`);
  if (profile.smallBusinessCertId) entries.push(`smallBusinessCertId: ${profile.smallBusinessCertId}`);
  if (profile.smallBusinessCertExpiration) entries.push(`smallBusinessCertExpiration: ${profile.smallBusinessCertExpiration}`);
  if (profile.entityType) entries.push(`entityType: ${profile.entityType}`);
  if (profile.authorizedSignatory) {
    entries.push(`authorizedSignatory.name: ${profile.authorizedSignatory.name}`);
    entries.push(`authorizedSignatory.title: ${profile.authorizedSignatory.title}`);
  }
  for (const field of profile.fields ?? []) {
    entries.push(`fields.${field.key}: ${field.value}`);
  }
  return entries.join('\n');
};

export const matchFieldsToProfile = async (
  fields: DetectedFormField[],
  profile: CompanyProfileItem,
  documentText?: string,
): Promise<MatchResult[]> => {
  const results: MatchResult[] = [];

  for (const field of fields) {
    if (field.status === 'MANUAL_REQUIRED') {
      results.push({
        fieldId: field.fieldId,
        profileFieldKey: null,
        value: null,
        confidence: 0,
        manualReason: field.manualReason,
      });
      continue;
    }

    const isAlwaysManual = ALWAYS_MANUAL_PATTERNS.some((p) => p.test(field.label));
    if (isAlwaysManual) {
      const signatoryName = profile.authorizedSignatory?.name;
      const reason = /signature|sign/i.test(field.label)
        ? signatoryName ? `Authorized Signature — ${signatoryName}` : 'Requires authorized signature'
        : /date/i.test(field.label) ? 'Date — enter at time of signing'
        : 'Opportunity-specific field';
      results.push({
        fieldId: field.fieldId,
        profileFieldKey: null,
        value: null,
        confidence: 0,
        manualReason: reason,
      });
      continue;
    }

    results.push({
      fieldId: field.fieldId,
      profileFieldKey: null,
      value: null,
      confidence: 0,
      manualReason: null,
    });
  }

  const unmatchedFields = fields.filter(
    (f) => !ALWAYS_MANUAL_PATTERNS.some((p) => p.test(f.label)) && f.status !== 'MANUAL_REQUIRED',
  );

  if (unmatchedFields.length === 0) return results;

  const profileContext = buildProfileContext(profile);
  const fieldLabels = unmatchedFields.map((f) => ({ fieldId: f.fieldId, label: f.label }));

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You match form field labels to company profile data for a government vendor/contractor form. ' +
      'The company filling this form is the VENDOR/CONSULTANT/CONTRACTOR. ' +
      'For each field, return the best matching profile key and confidence (0-1). ' +
      'Common mappings: "Consultant Name"/"Vendor Name"/"Contractor Name"/"Corporation Name" → companyName; ' +
      '"Address"/"Mailing Address" → address; "City" → city; "State" → state; "Zip" → zip; ' +
      '"Phone"/"Telephone" → phone; "Email" → email; "EIN"/"Tax ID"/"FEIN" → ein; ' +
      '"Entity Type" → entityType; "Signature" → authorizedSignatory.name. ' +
      'Return ONLY valid JSON.',
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text:
          'Match these form fields to the company profile data below. This is a vendor/contractor form.\n\n' +
          'COMPANY PROFILE:\n' + profileContext + '\n\n' +
          (documentText ? `DOCUMENT TEXT (form instructions):\n${documentText.slice(0, 20_000)}\n\n` : '') +
          'FORM FIELDS TO MATCH:\n' + JSON.stringify(fieldLabels) + '\n\n' +
          'Return JSON array: [{ "fieldId": string, "profileFieldKey": string|null, "confidence": number }]\n' +
          'Be aggressive with matching — if a field could reasonably be filled from the profile, match it with high confidence.\n' +
          'If no match exists, set profileFieldKey to null and confidence to 0.',
      }],
    }],
    temperature: 0,
    max_tokens: 4000,
  };

  try {
    const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(body));
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
    const matches = rawText ? (safeParseJsonFromModel(String(rawText)) as Array<{ fieldId: string; profileFieldKey: string | null; confidence: number }>) : [];

    console.log(`Field matcher LLM returned ${Array.isArray(matches) ? matches.length : 0} matches`);

    if (Array.isArray(matches)) {
      for (const match of matches) {
        const resultIdx = results.findIndex((r) => r.fieldId === match.fieldId);
        if (resultIdx === -1) continue;

        const profileKey = match.profileFieldKey;
        const confidence = match.confidence ?? 0;

        if (profileKey && confidence > 0.3) {
          console.log(`  Match: fieldId=${match.fieldId.slice(0,8)} key=${profileKey} conf=${confidence}`);
        }

        if (profileKey && confidence >= CONFIDENCE_THRESHOLD) {
          const value = getProfileValue(profile, profileKey);
          results[resultIdx] = {
            fieldId: match.fieldId,
            profileFieldKey: profileKey,
            value,
            confidence,
            manualReason: null,
          };
        } else if (profileKey && confidence > 0.5) {
          const value = getProfileValue(profile, profileKey);
          results[resultIdx] = {
            fieldId: match.fieldId,
            profileFieldKey: profileKey,
            value,
            confidence,
            manualReason: null,
          };
        }
      }
    }
  } catch (err) {
    console.warn('Field matching LLM call failed (non-fatal):', (err as Error)?.message);
  }

  return results;
};

const getProfileValue = (profile: CompanyProfileItem, key: string): string | null => {
  if (key.startsWith('fields.')) {
    const fieldKey = key.replace('fields.', '');
    const field = profile.fields?.find((f) => f.key === fieldKey);
    return field?.value ?? null;
  }
  if (key.startsWith('authorizedSignatory.')) {
    const subKey = key.replace('authorizedSignatory.', '') as keyof NonNullable<CompanyProfileItem['authorizedSignatory']>;
    return profile.authorizedSignatory?.[subKey] ?? null;
  }
  const val = (profile as unknown as Record<string, unknown>)[key];
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(', ');
  return null;
};
