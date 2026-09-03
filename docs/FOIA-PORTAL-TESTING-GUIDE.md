# FOIA Portal Automation - Testing Guide

## Testing Workflow

### Prerequisites
1. ✅ Have an Organization created
2. ✅ Have a Project created
3. ✅ Have an Opportunity created (must be WON or LOST status)

---

## Step-by-Step Testing

### Step 1: Navigate to FOIA Section
- Go to your opportunity
- Find the FOIA/Public Records section
- Click "Create FOIA Request"

### Step 2: Fill Out FOIA Request Form

**Test Case 1: Agency WITH Portal (Should Auto-Detect)**

Fill in these fields:
```
Agency Name: California Department of Fish and Wildlife
Agency Domain: californiadfw.govqa.us (optional)
Agency FOIA Email: foia@wildlife.ca.gov
Agency Address: 1416 Ninth Street, Sacramento, CA 95814

Solicitation Number: W911NF-21-R-0001
Contract Title: IT Services Contract
Requested Documents: [Select some documents]
Award Date: January 15, 2026
Awardee Name: WinnerCo LLC
Fee Limit: $100

Requester Name: John Doe
Requester Title: Contracts Manager
Requester Email: john@yourcompany.com
Requester Phone: 555-123-4567
Requester Address: 123 Main St, City, ST 12345
Company Name: Your Company
```

Click **"Create FOIA Request"**

---

### Step 3: Verify Portal Detection

**✅ What You Should See:**

The created FOIA request should display:

1. **Portal Badge/Indicator**: "GovQA Portal Detected" or similar
2. **Portal Information Section**:
   - Portal Type: GovQA
   - Portal URL: https://californiadfw.govqa.us
   - Record Type Field: type_of_record_requested
   - Record Type Value: California Department of Fish and Wildlife

**🔍 How to Verify in DevTools:**

1. Open Browser DevTools (F12)
2. Go to Network tab
3. Find the `create-foia-request` POST request
4. Check Response tab - should contain:
   ```json
   {
     "foiaRequest": {
       "portalDetected": true,
       "portalType": "GovQA",
       "portalBaseUrl": "https://californiadfw.govqa.us",
       "portalRecordTypeField": "type_of_record_requested",
       "portalRecordTypeValue": "California Department of Fish and Wildlife"
     }
   }
   ```

---

### Step 4: Test Portal Submission

**Option A: Click "Submit to Portal" Button** (if UI implemented)

Expected behavior:
- System calls `/foia/submit-to-portal` endpoint
- Returns: "Manual review required" (without CAPTCHA service)
- Status changes to: `MANUAL_REVIEW`
- Shows portal URL for manual submission

**Option B: Test via API**

```bash
curl -X POST https://d23koec59lgaya.cloudfront.net/foia/submit-to-portal \
  -H "Authorization: Bearer $YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "your-org-id",
    "projectId": "your-project-id",
    "opportunityId": "your-opportunity-id",
    "foiaRequestId": "foia-request-id-from-step-2"
  }'
```

Expected response:
```json
{
  "message": "Portal submission requires manual review",
  "error": "GovQA submission service not configured"
}
```

Status Code: `202 Accepted`

---

### Step 5: Manual Portal Submission

1. Click the portal URL: https://californiadfw.govqa.us
2. Portal opens in new tab
3. Fill out the form with the information from your FOIA request
4. Select correct record type: "California Department of Fish and Wildlife"
5. Solve CAPTCHA manually
6. Submit form
7. Copy confirmation number
8. Return to app and update FOIA request status

---

## Test Case 2: Agency WITHOUT Portal (Should Fall Back to Email)

Create another FOIA request with:

```
Agency Name: Unknown County Agency
Agency Domain: (leave empty)
```

**Expected Behavior:**
- `portalDetected: false`
- No portal information shown
- System scraped agency website for email (if found)
- Shows email-based submission option only

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Creates FOIA Request                 │
│  (Opportunity → FOIA Section → Create FOIA Request)          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           POST /foia/create-foia-request                     │
│  • Validates input                                           │
│  • Calls detectAgencyPortal(agencyName, agencyDomain)        │
│  • Saves to DynamoDB with portal metadata                    │
└────────────────────────┬────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
   ┌────────────────┐        ┌───────────────┐
   │ Portal Detected│        │ No Portal     │
   │ portalDetected │        │ portalDetected│
   │     = true     │        │    = false    │
   └────────┬───────┘        └───────┬───────┘
            │                        │
            ▼                        ▼
   ┌────────────────┐        ┌───────────────┐
   │ UI Shows:      │        │ UI Shows:     │
   │ • Portal type  │        │ • Email draft │
   │ • Portal URL   │        │ • Coordinator │
   │ • Record type  │        │   info        │
   │ • Submit button│        │               │
   └────────┬───────┘        └───────────────┘
            │
            ▼
   ┌────────────────────────────────────┐
   │ User Clicks "Submit to Portal"     │
   └────────────────┬───────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────────┐
   │     POST /foia/submit-to-portal                    │
   │  • Re-detects portal (ensure fresh info)           │
   │  • Calls submitToPortal() → routes by portal type  │
   │  • Attempts submission (returns manual review)     │
   │  • Updates status: PENDING → MANUAL_REVIEW         │
   │  • Logs audit action: FOIA_REQUEST_SENT/FAILED     │
   └────────────────┬───────────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────┐
   │         Response: Manual Review Required       │
   │  {                                             │
   │    "message": "Portal submission requires      │
   │                manual review",                 │
   │    "error": "GovQA submission service not      │
   │              configured"                       │
   │  }                                             │
   │                                                │
   │  Status: 202 Accepted                          │
   └────────────────┬───────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────┐
   │          UI Shows Manual Submission Flow        │
   │  • Portal URL link (opens in new tab)          │
   │  • Instructions: "Select record type: CDFW"    │
   │  • User submits manually                       │
   │  • User marks as submitted in app              │
   └────────────────────────────────────────────────┘
```

---

## Backend Flow Diagram

```
create-foia-request.ts
  │
  ├─► Validate input (Zod schema)
  │
  ├─► detectAgencyPortal(agencyName, agencyDomain?)
  │     │
  │     ├─► Check domain patterns (.govqa.us, .nextrequest.com, etc.)
  │     │
  │     ├─► Check AGENCY_PORTAL_PATTERNS (known agencies)
  │     │     - "California Department of Fish and Wildlife" → californiadfw.govqa.us
  │     │     - Sets recordTypeField & recordTypeValue
  │     │
  │     ├─► searchForPortal() - Try common URL patterns
  │     │
  │     └─► Return DetectedPortal
  │           - detected: boolean
  │           - type: PortalType
  │           - baseUrl: string
  │           - recordTypeField?: string
  │           - recordTypeValue?: string
  │
  ├─► If !portalDetected → scrapeAgencyContactInfo()
  │     └─► Extract email, phone, citation from agency website
  │
  ├─► Save to DynamoDB with portal metadata
  │
  └─► Return response with portal info

submit-to-portal.ts
  │
  ├─► Validate input
  │
  ├─► getFOIARequest() from DynamoDB
  │
  ├─► Check if portalDetected
  │
  ├─► Check if already submitted
  │
  ├─► Re-detect portal (ensure current info)
  │
  ├─► Build FOIASubmissionData
  │
  ├─► retryPortalSubmission()
  │     │
  │     ├─► submitToPortal() → routes by portal type
  │     │     │
  │     │     ├─► GovQA → submitToGovQA()
  │     │     │     └─► Check GOVQA_SUBMISSION_SERVICE_URL
  │     │     │         - If not set → requiresManualReview: true
  │     │     │         - If set → call Python service (govqa-py)
  │     │     │
  │     │     ├─► NextRequest → submitToNextRequest()
  │     │     │     └─► requiresManualReview: true (not implemented)
  │     │     │
  │     │     └─► JustFOIA, GovOS → similar
  │     │
  │     └─► Retry with exponential backoff (if needed)
  │
  ├─► Update DynamoDB:
  │     - submissionStatus: MANUAL_REVIEW
  │     - submissionAttempts: +1
  │     - submissionError: "GovQA submission service not configured"
  │
  ├─► Log audit action: FOIA_REQUEST_FAILED
  │
  └─► Return 202 with manual review message
```

---

## Data Flow

### Create FOIA Request
```
Frontend Form Data
  ↓
POST /foia/create-foia-request
  ↓
Lambda Handler (create-foia-request.ts)
  ↓
detectAgencyPortal() helper
  ↓
DynamoDB (with portal fields)
  ↓
Response to Frontend (with portal metadata)
```

### Submit to Portal
```
Submit Button Click
  ↓
POST /foia/submit-to-portal
  ↓
Lambda Handler (submit-to-portal.ts)
  ↓
getFOIARequest() → detectAgencyPortal() → submitToPortal()
  ↓
Update DynamoDB (submissionStatus: MANUAL_REVIEW)
  ↓
Audit Log (FOIA_REQUEST_SENT/FAILED)
  ↓
Response to Frontend (202 + manual review message)
```

---

## Verification Checklist

### ✅ Portal Detection
- [ ] Response includes `portalDetected: true`
- [ ] Response includes `portalType: "GovQA"`
- [ ] Response includes `portalBaseUrl: "https://californiadfw.govqa.us"`
- [ ] Response includes `recordTypeField` and `recordTypeValue`
- [ ] UI displays portal information

### ✅ Portal Submission
- [ ] Submit button/endpoint exists
- [ ] Returns 202 status code
- [ ] Returns "manual review required" message
- [ ] DynamoDB updated with `submissionStatus: "MANUAL_REVIEW"`
- [ ] Audit log entry created

### ✅ Fallback (No Portal)
- [ ] Response includes `portalDetected: false`
- [ ] System attempts email scraping
- [ ] UI shows email-based submission option

### ✅ End-to-End
- [ ] User can create FOIA request
- [ ] Portal auto-detected for known agencies
- [ ] User can click portal URL
- [ ] Portal opens with correct URL
- [ ] User can manually submit
- [ ] System tracks submission status

---

## Known Issues / Expected Behavior

### ⚠️ Without CAPTCHA Service (Current State)

**Expected:**
- Portal detection: ✅ Works
- Submit endpoint: ✅ Works
- Actual automated submission: ❌ Returns manual review

**Reason:**
- `GOVQA_SUBMISSION_SERVICE_URL` environment variable not set
- Python service with govqa-py not deployed
- CAPTCHA solver not configured

**User Experience:**
1. System detects portal ✅
2. System tells user which portal and record type ✅
3. User clicks portal link ✅
4. User submits manually (solves CAPTCHA themselves) ✅
5. System tracks submission status ✅

This is **acceptable for production** - the automation provides:
- ✅ Automatic portal discovery (no manual research)
- ✅ Correct portal URL and form field instructions
- ✅ Status tracking
- ❌ Fully automated submission (requires CAPTCHA service - optional phase 2)

---

## Test Scenarios

### Scenario 1: California Department of Fish and Wildlife
- **Expected**: Portal detected (GovQA)
- **Portal URL**: https://californiadfw.govqa.us
- **Record Type**: "California Department of Fish and Wildlife"

### Scenario 2: Fish and Game Commission
- **Expected**: Portal detected (GovQA)
- **Portal URL**: https://californiadfw.govqa.us
- **Record Type**: "Fish and Game Commission"

### Scenario 3: Unknown Agency
- **Expected**: Portal NOT detected
- **Fallback**: Email scraping (if agency has public website)

### Scenario 4: Agency with .govqa.us Domain
- **Input**: agencyDomain: "someagency.govqa.us"
- **Expected**: Portal detected by domain pattern
- **Portal Type**: GovQA

---

## Troubleshooting

### Portal Not Detected
1. Check agency name spelling
2. Check if agency is in `AGENCY_PORTAL_PATTERNS` (packages/infra/api/routes/portal-detection.ts)
3. Check CloudWatch logs for detection errors
4. Verify agency actually has a portal

### Submit Returns 404
1. Verify API URL is CloudFront: https://d23koec59lgaya.cloudfront.net
2. Check route exists: POST /foia/submit-to-portal
3. Verify Lambda deployed successfully

### UI Not Showing Portal Info
1. Check Network tab - does response include portal fields?
2. Check frontend code is reading `portalDetected` field
3. Verify UI components are implemented for portal display

---

## Next Steps After Testing

### Phase 1 (Current - Manual Submission)
- ✅ Portal detection working
- ✅ Status tracking working
- ✅ Manual submission workflow working

### Phase 2 (Optional - Full Automation)
1. Set up CAPTCHA service (2Captcha or Anti-Captcha)
2. Deploy Python Lambda layer with govqa-py
3. Set `GOVQA_SUBMISSION_SERVICE_URL` environment variable
4. Test automated submission
5. Monitor success rates

---

## Success Metrics

### Portal Detection
- **Target**: 90%+ of known portal agencies detected
- **Measure**: `portalDetected: true` rate for GovQA/NextRequest agencies

### Time Savings
- **Before**: 10-15 minutes to research portal URL and fields
- **After**: Instant (portal info provided automatically)
- **Savings**: ~10 minutes per FOIA request

### User Satisfaction
- **Measure**: Fewer support tickets about "which portal to use"
- **Measure**: Faster FOIA request creation

---

## Support

If you encounter issues:
1. Check CloudWatch logs: `/aws/lambda/autorfp-foia-create-horus-dev`
2. Check DynamoDB: Verify portal fields saved correctly
3. Check Network tab: Verify response includes portal metadata
4. Contact: AutoRFP team
