# Linear API Key Implementation Test Checklist

## Implementation Summary
The Linear API key configuration has been successfully implemented in the organization settings, following the same pattern as the SAM.gov API key implementation.

## Changes Made

### 1. Backend Schema Updates
- ✅ Updated `infrastructure/lambda/schemas/organization.ts` to include `linearApiKey` field
- ✅ Updated `shared/src/schemas/organization.ts` to include `linearApiKey` field
- ✅ Added `linearApiKey` to create, update, and base organization schemas

### 2. Lambda Function Updates
- ✅ Updated `infrastructure/lambda/organization/create.ts` to handle `linearApiKey`
- ✅ Updated `infrastructure/lambda/organization/update.ts` to handle `linearApiKey`
- ✅ Get and List functions automatically include the new field

### 3. Frontend Type Updates
- ✅ Updated `web-app/types/organization.ts` to include `linearApiKey` in Organization interface

### 4. UI Updates
- ✅ Added Linear API key input field in `web-app/app/organizations/[orgId]/settings/page.tsx`
- ✅ Added show/hide toggle for Linear API key (similar to SAM.gov API key)
- ✅ Added state management for Linear API key
- ✅ Added help text with link to Linear API settings
- ✅ Integrated Linear API key into form submission

### 5. Test Updates
- ✅ Updated E2E tests in `web-app/e2e/organization-settings.auth.spec.ts`
- ✅ Added test coverage for Linear API key input
- ✅ Added test coverage for Linear API key visibility toggle

## Manual Testing Steps