# Portal UI Testing Guide

## What We Just Built ✅

### 1. Portal Information Display
- Shows blue info box when portal is detected
- Displays portal type, URL, record type field/value
- Shows "Submit to Portal" button

### 2. Portal Submission Modal
- Step-by-step guided submission
- Copy buttons for each field
- Opens portal in new tab
- Marks as submitted when done

---

## How to Test

### **Step 1: Start Dev Server**
```bash
cd apps/web
pnpm dev
```

Open: http://localhost:3000

---

### **Step 2: Create Test FOIA Request**

1. Go to an opportunity (must be Won or Lost)
2. Scroll to "FOIA Request" card
3. Click **"Create FOIA Request"**
4. Fill in form with:

```
Agency Name: California Department of Fish and Wildlife
FOIA Office Email: foia@wildlife.ca.gov
FOIA Office Address: 1416 Ninth Street, Sacramento, CA 95814

Solicitation Number: W911NF-21-R-0001
Contract Title: IT Services Contract
Award Date: 2026-01-15
Awardee Name: WinnerCo LLC

[Check some document types]

[Fill in your contact info]
```

5. Click **"Create FOIA Request"**

---

### **Step 3: Verify Portal Detection UI**

After creating, you should see:

```
┌─────────────────────────────────────────┐
│ FOIA Request                            │
├─────────────────────────────────────────┤
│ 🏢 California Department of Fish...     │
│ ✉️  foia@wildlife.ca.gov                │
│ 📍 1416 Ninth Street...                 │
│                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ ← NEW!
│ 🌐 Portal Submission Required           │
│                                         │
│ Portal Type: GovQA                      │
│ Portal URL:                             │
│ https://californiadfw.govqa.us 🔗       │
│                                         │
│ Field Name: type_of_record_requested    │
│ Select Value:                           │
│ California Department of Fish and       │
│ Wildlife                                │
│                                         │
│ [🚀 Submit to Portal]                   │ ← NEW BUTTON!
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                         │
│ Solicitation: W911NF-21-R-0001         │
│ Contract: IT Services Contract          │
│                                         │
│ [Edit] [Draft Letter] [Delete]          │
└─────────────────────────────────────────┘
```

**What to look for:**
- ✅ Blue box with portal information
- ✅ "Portal Type: GovQA" displayed
- ✅ Portal URL is clickable link
- ✅ Record type field and value shown
- ✅ "Submit to Portal" button visible

---

### **Step 4: Test Portal Submission Flow**

Click **[🚀 Submit to Portal]** button

**Modal should appear:**

```
┌───────────────────────────────────────┐
│ Submit to Portal                      │
├───────────────────────────────────────┤
│                                       │
│ ① Open the Portal                    │
│ [https://californiadfw.govqa.us 🔗]  │ ← Clickable button
│                                       │
│ ② Select the Correct Record Type     │
│ Field: type_of_record_requested      │
│ ┌───────────────────────────────┐   │
│ │ California Department of Fish │   │
│ │ and Wildlife                  │ [📋] │ ← Copy button
│ └───────────────────────────────┘   │
│                                       │
│ ③ Fill in the Form Fields            │
│ ┌─────────────────────────────────┐ │
│ │ Agency Name                     │ │
│ │ California Dept...            [📋] │
│ │                                   │ │
│ │ Solicitation Number             │ │
│ │ W911NF-21-R-0001              [📋] │
│ │                                   │ │
│ │ Contract Title                  │ │
│ │ IT Services Contract          [📋] │
│ │                                   │ │
│ │ [... more fields ...]             │ │
│ └─────────────────────────────────┘ │
│                                       │
│ ④ Requested Documents                │
│ • Technical Proposal                 │
│ • Cost Proposal                      │
│                                       │
│ ⑤ Complete CAPTCHA and Submit        │
│ Solve the CAPTCHA on the portal      │
│ form and click their submit button.  │
│                                       │
│ ✓ Mark as Submitted                  │
│ After submitting on the portal,      │
│ click the button below.              │
│                                       │
│ [Cancel]  [I've Submitted]           │
└───────────────────────────────────────┘
```

---

### **Step 5: Test the Flow**

**A. Test Portal Opens:**
1. Click the portal URL button in step ①
2. Verify: New tab opens with https://californiadfw.govqa.us
3. Verify: Portal form loads correctly

**B. Test Copy Buttons:**
1. Click [📋] button next to "California Department of Fish and Wildlife"
2. Verify: Toast appears "Copied"
3. Verify: Check mark appears briefly on button
4. Paste somewhere to confirm it copied correctly

**C. Test Field Copying:**
1. Click copy button for "Solicitation Number"
2. Verify: "W911NF-21-R-0001" is copied
3. Try copying other fields

**D. Test Mark as Submitted:**
1. Click **"I've Submitted"** button
2. Verify: Modal closes
3. Verify: Success toast appears
4. Verify: FOIA request status updated

---

### **Step 6: Test "No Portal" Case**

Create another FOIA request with:
```
Agency Name: Unknown Test Agency
[Fill other fields...]
```

**Expected Result:**
```
┌─────────────────────────────────────┐
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ✉️ No portal detected - email       │
│    submission available             │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
```

Gray box instead of blue, no submit button.

---

## What to Check

### ✅ Portal Detection Working
- [ ] Blue box appears for California Dept Fish and Wildlife
- [ ] Portal type shows "GovQA"
- [ ] Portal URL is https://californiadfw.govqa.us
- [ ] Record type field shown
- [ ] Record type value shown

### ✅ Submit Button Working
- [ ] "Submit to Portal" button appears
- [ ] Button is blue with icon
- [ ] Clicking opens modal

### ✅ Modal Working
- [ ] Modal displays step-by-step instructions
- [ ] Portal URL button opens new tab
- [ ] Copy buttons work for all fields
- [ ] Copy buttons show checkmark feedback
- [ ] Toast notifications appear
- [ ] "I've Submitted" button works
- [ ] Modal closes after submission

### ✅ No Portal Case
- [ ] Gray box appears when no portal detected
- [ ] Message says "email submission available"
- [ ] No submit button shown

---

## Backend Verification

### Check DevTools Network Tab

After creating FOIA request:
1. Open DevTools (F12)
2. Network tab
3. Find `create-foia-request` request
4. Check Response:

```json
{
  "foiaRequest": {
    "portalDetected": true,        ← Should be true
    "portalType": "GovQA",          ← Should be present
    "portalBaseUrl": "https://...", ← Should be present
    ...
  }
}
```

After clicking "I've Submitted":
1. Network tab
2. Find `submit-to-portal` request
3. Should return 202 status
4. Response includes success message

---

## Known Issues / Expected Behavior

### ⚠️ CAPTCHA Service Not Configured
- Submission returns "manual review required"
- This is expected - CAPTCHA automation not built yet
- User still needs to solve CAPTCHA manually
- The UI helps by:
  - Showing correct portal
  - Showing correct field values
  - Providing copy buttons
  - Tracking submission status

### ⚠️ TypeScript Errors in Tests
- Some test files have unrelated errors
- Our FOIA components compile correctly
- Errors are in question editor tests, not FOIA tests

---

## Success Criteria

**User Experience Goal:**
- User creates FOIA request
- System shows: "This agency requires portal submission"
- System shows: Exactly where to go and what to fill in
- User clicks portal link
- User copies values (one click per field)
- User pastes into portal (2 minutes)
- User solves CAPTCHA
- User submits
- User marks as done in our app

**Time Saved:**
- Before: 15 minutes (research + manual entry)
- After: 5 minutes (guided copy/paste)
- **Savings: 10 minutes per request**

---

## Next Steps (Future)

### Phase 2: Full Automation (Optional)
- Set up govqa-py Python service
- Add CAPTCHA solver integration
- Fully automate form submission
- User just clicks "Submit" and waits

**Estimated Additional Work:** 3-5 days
**Additional Cost:** $0.50-$2 per submission (CAPTCHA solving)
**Value vs Current:** Saves additional 4 minutes, but adds complexity

---

## Troubleshooting

### Portal Info Not Showing
- Check DevTools response includes `portalDetected: true`
- Verify backend is deployed
- Try different agency name (California Department of Fish and Wildlife)

### Modal Not Opening
- Check browser console for errors
- Verify button is clickable
- Check modal state with React DevTools

### Copy Buttons Not Working
- Check browser clipboard permissions
- Try manual copy/paste of values
- Check browser console for errors

### "I've Submitted" Not Working
- Check Network tab for 404/500 errors
- Verify API URL is correct in .env.local
- Check backend logs in CloudWatch
