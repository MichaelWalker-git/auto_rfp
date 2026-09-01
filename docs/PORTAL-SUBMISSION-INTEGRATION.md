# Portal Submission Integration Guide

## Overview

This document outlines the approach for implementing automated submission to public records request portals, building on the portal detection system implemented in HOR-2745.

## Current State

✅ **Portal Detection** - The system can now:
- Detect GovQA, NextRequest, JustFOIA, and GovOS portals
- Identify required form fields (e.g., record type for sub-entities)
- Fall back to email coordinator scraping when no portal exists
- Log detection events for audit trail

## Next Steps: Form Submission

### Option 1: govqa-py Library (Recommended for GovQA)

**govqa-py** is an unofficial open-source Python client that automates GovQA form submission via HTTP.

#### Pros
- Already handles GovQA's dynamic form schema
- Community-maintained with real-world usage
- Handles most of the submission complexity

#### Cons
- Requires CAPTCHA solving (manual or third-party)
- Unofficial/unmaintained by Granicus
- May break if GovQA changes their form structure
- Python dependency in Node.js project

#### Integration Approach

1. **Create Python microservice** or Lambda function:
   ```python
   from govqa import GovQA
   
   def submit_request(portal_url, form_data, record_type):
       client = GovQA(portal_url)
       client.login()  # If required
       
       # Fetch dynamic form schema
       form = client.get_request_form()
       
       # Map our data to form fields
       form.set_field('type_of_record_requested', record_type)
       form.set_field('description', form_data['description'])
       # ... other fields
       
       # Solve CAPTCHA (manual or service)
       captcha_token = solve_captcha(form.captcha_challenge)
       
       # Submit
       result = form.submit(captcha_token)
       return result
   ```

2. **Call from Node.js handler**:
   ```typescript
   // apps/functions/src/handlers/foia/submit-foia-request.ts
   import { spawn } from 'child_process';
   
   const submitToPortal = async (portalInfo, formData) => {
     if (portalInfo.type === 'GovQA') {
       // Call Python service
       const result = await callPythonSubmission(portalInfo.baseUrl, formData);
       return result;
     }
   };
   ```

3. **CAPTCHA handling options**:
   - **2Captcha** or **Anti-Captcha** API (paid, reliable)
   - **Manual review queue** (fallback for automation failures)
   - **hCaptcha/reCAPTCHA solver libraries**

#### Implementation Checklist

- [ ] Set up Python Lambda layer or microservice
- [ ] Install and configure govqa-py
- [ ] Integrate CAPTCHA solving service
- [ ] Create submission handler in Node.js
- [ ] Add submission status tracking to FOIA request schema
- [ ] Implement retry logic for failed submissions
- [ ] Add monitoring for form schema changes

### Option 2: Headless Browser Automation (Universal Approach)

For portals without dedicated libraries, or as a fallback:

#### Using Playwright

```typescript
// apps/functions/src/helpers/portal-submission.ts
import { chromium } from 'playwright';

export const submitViaPlaywright = async (portalInfo, formData) => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    await page.goto(portalInfo.baseUrl);
    
    // Fill form fields
    await page.selectOption('#recordType', portalInfo.recordTypeValue);
    await page.fill('#description', formData.description);
    await page.fill('#requesterName', formData.requesterName);
    // ... other fields
    
    // Handle CAPTCHA (may require manual intervention)
    await solveCaptcha(page);
    
    // Submit
    await page.click('#submitButton');
    await page.waitForNavigation();
    
    // Verify submission
    const confirmationText = await page.textContent('.confirmation');
    return { success: true, confirmation: confirmationText };
  } finally {
    await browser.close();
  }
};
```

#### Pros
- Works with any portal
- Can handle complex interactions
- Visual debugging possible

#### Cons
- Slower than HTTP-based submission
- Higher resource usage (Lambda container size)
- More brittle to UI changes
- Harder to run in Lambda (need Playwright AWS Lambda layer)

### Option 3: Direct HTTP API (If Available)

Some portals may have undocumented APIs. Research needed per platform.

## Data Flow

```
┌─────────────────┐
│ Create FOIA Req │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Portal Detection│────▶│ Portal Detected?│
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │ Yes                     │ No
                    ▼                         ▼
         ┌─────────────────────┐    ┌──────────────────┐
         │ Queue for Submission│    │ Send Email CPRA  │
         └──────────┬──────────┘    └──────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Submit to Portal    │
         │ (govqa-py/Playwright)│
         └──────────┬──────────┘
                    │
         ┌──────────┼──────────┐
         │ Success            │ Failure
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│ Mark as Sent    │  │ Retry Queue     │
│ Store Receipt   │  │ (or Manual)     │
└─────────────────┘  └─────────────────┘
```

## Schema Extensions

Already implemented in core schemas:

```typescript
// packages/core/src/schemas/foia.ts
export const FOIARequestItemSchema = z.object({
  // ... existing fields
  
  // Portal detection (implemented)
  portalDetected: z.boolean().optional(),
  portalType: PortalTypeSchema.optional(),
  portalBaseUrl: z.string().optional(),
  portalRecordTypeField: z.string().optional(),
  portalRecordTypeValue: z.string().optional(),
  
  // TODO: Add submission tracking
  // submissionStatus: z.enum(['PENDING', 'SUBMITTED', 'FAILED', 'MANUAL_REVIEW']).optional(),
  // submissionAttempts: z.number().optional(),
  // submissionError: z.string().optional(),
  // submissionConfirmationNumber: z.string().optional(),
  // submittedAt: z.string().datetime().optional(),
});
```

## Testing Strategy

### Unit Tests
- ✅ Portal detection logic
- ✅ Agency scraping
- [ ] Form submission (mocked)

### Integration Tests
- [ ] Smoke test against live GovQA instance (CDFW)
- [ ] Test CAPTCHA solving
- [ ] Test retry logic

### Manual Testing Checklist
- [ ] Submit test request to CDFW portal
- [ ] Verify confirmation email received
- [ ] Verify request appears in portal
- [ ] Test failure scenarios (invalid data, portal down)
- [ ] Test CAPTCHA solving reliability

## Monitoring & Alerting

Track:
- Submission success rate per portal
- CAPTCHA solving success rate
- Average submission time
- Form schema change detection

Alert on:
- Submission success rate < 90%
- Multiple consecutive CAPTCHA failures
- Portal structure changes (form fields not found)

## Security Considerations

1. **Credentials**: If portals require login, store credentials in Secrets Manager
2. **CAPTCHA tokens**: Never log or expose CAPTCHA solving service credentials
3. **Rate limiting**: Respect portal rate limits to avoid IP blocking
4. **Data validation**: Sanitize all form inputs to prevent injection

## Cost Estimates

- **govqa-py approach**: ~$0.01-0.05 per submission (Lambda + CAPTCHA service)
- **Playwright approach**: ~$0.10-0.20 per submission (larger Lambda, longer runtime)
- **CAPTCHA solving**: ~$0.001-0.003 per CAPTCHA (2Captcha pricing)

## Rollout Plan

1. **Phase 1** (Current): Portal detection + email fallback
2. **Phase 2**: govqa-py integration for GovQA (CDFW smoke test)
3. **Phase 3**: Expand to other GovQA instances
4. **Phase 4**: Add support for other portal platforms (NextRequest, JustFOIA)
5. **Phase 5**: Full automation with monitoring

## References

- [govqa-py GitHub](https://github.com/govqa/govqa-py) (Note: Verify current repo)
- [govqa-py Documentation](https://govqa-py.readthedocs.io)
- [Playwright AWS Lambda](https://playwright.dev/docs/ci#aws-lambda)
- [2Captcha API Docs](https://2captcha.com/2captcha-api)
- Task: HOR-2745 (this implementation)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-01 | Implement detection first | Get portal metadata before submission complexity |
| 2026-09-01 | Defer govqa-py integration | Detection alone provides value; submission needs CAPTCHA strategy |
| TBD | Choose CAPTCHA service | Pending evaluation of 2Captcha vs Anti-Captcha vs manual queue |
| TBD | Deploy Python service or Lambda layer | Depends on govqa-py decision |
