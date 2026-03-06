# Template Variables Reference

This document lists all available template variables (macros) that can be used in RFP document templates.

## Usage

Template variables use the syntax `{{VARIABLE_NAME}}` and are automatically replaced with real data during document generation.

**Example:**
```html
<p>Dear {{AGENCY_NAME}} Contracting Officer,</p>
<p>{{COMPANY_NAME}} is pleased to submit this proposal in response to solicitation {{SOLICITATION_NUMBER}}.</p>
<p>Our proposed solution for {{OPPORTUNITY_TITLE}} addresses all requirements specified in the Statement of Work.</p>
```

---

## Organization Variables

Variables derived from the organization (company) information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{COMPANY_NAME}}` | Your organization/company name | "Acme Technologies, Inc." |
| `{{ORGANIZATION_DESCRIPTION}}` | Organization description/overview | "Leading provider of cloud solutions..." |

---

## Project Variables

Variables derived from the project information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{PROJECT_TITLE}}` | Project name | "NASA Ground Systems Modernization" |
| `{{PROJECT_DESCRIPTION}}` | Project description (optional) | "Modernization of legacy ground control systems..." |
| `{{PROPOSAL_TITLE}}` | Proposal title (alias for PROJECT_TITLE) | "NASA Ground Systems Modernization" |

---

## Opportunity Variables

Variables derived from the SAM.gov opportunity or solicitation information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{OPPORTUNITY_ID}}` | Unique opportunity identifier | "140D6424R00004" |
| `{{OPPORTUNITY_TITLE}}` | Official title of the opportunity | "Enterprise Cloud Services - Full Stack" |
| `{{SOLICITATION_NUMBER}}` | Official solicitation number | "FA8201-24-R-0001" |
| `{{NOTICE_ID}}` | SAM.gov notice ID | "140d6424r00004" |

---

## Agency/Customer Information

Variables for the issuing agency or customer.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{AGENCY_NAME}}` | Primary agency name (short form) | "GSA" |
| `{{ISSUING_OFFICE}}` | Full issuing office name | "General Services Administration, Federal Acquisition Service" |

---

## Date Variables

Current date and deadline information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{TODAY}}` | Current date (YYYY-MM-DD format) | "2024-03-15" |
| `{{CURRENT_YEAR}}` | Current year | "2024" |
| `{{CURRENT_MONTH}}` | Current month name | "March" |
| `{{CURRENT_DAY}}` | Current day of month | "15" |
| `{{POSTED_DATE}}` | Date opportunity was posted | "January 15, 2024" |
| `{{RESPONSE_DEADLINE}}` | Proposal submission deadline | "March 30, 2024" |
| `{{SUBMISSION_DATE}}` | Alias for RESPONSE_DEADLINE | "March 30, 2024" |

---

## Compliance & Classification

Variables for compliance codes and set-aside information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{NAICS_CODE}}` | North American Industry Classification System code | "541512" |
| `{{PSC_CODE}}` | Product/Service Code | "D302" |
| `{{SET_ASIDE}}` | Set-aside category | "Total Small Business Set-Aside" |
| `{{OPPORTUNITY_TYPE}}` | Type of opportunity/contract | "Combined Synopsis/Solicitation" |

**Common SET_ASIDE values:**
- "Total Small Business Set-Aside"
- "8(a) Set-Aside"
- "HUBZone Set-Aside"
- "Service-Disabled Veteran-Owned Small Business Set-Aside"
- "Women-Owned Small Business Set-Aside"
- "Full and Open Competition"

**Common OPPORTUNITY_TYPE values:**
- "Combined Synopsis/Solicitation"
- "Solicitation"
- "Sources Sought"
- "Request for Information (RFI)"
- "Request for Proposal (RFP)"
- "Request for Quotation (RFQ)"

---

## Financial Variables

Contract value information.

| Variable | Description | Example |
|----------|-------------|---------|
| `{{ESTIMATED_VALUE}}` | Estimated contract value (formatted as USD) | "$5,000,000" |
| `{{BASE_AND_OPTIONS_VALUE}}` | Total base + option periods value | "$5,000,000" |

---

## Content Placeholder

Special variable for template content areas.

| Variable | Description |
|----------|-------------|
| `{{CONTENT}}` | Placeholder for AI-generated or user-authored content. This is automatically replaced during document generation. |

**Usage in templates:**
```html
<h2>Technical Approach</h2>
{{CONTENT}}
```

The AI will replace `{{CONTENT}}` with substantive paragraphs addressing the section requirements.

---

## Complete Example Template

Here's a complete cover letter template using multiple variables:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cover Letter - {{SOLICITATION_NUMBER}}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">

<div style="text-align: right; margin-bottom: 2em;">
  {{TODAY}}
</div>

<div style="margin-bottom: 2em;">
  {{ISSUING_OFFICE}}<br>
  RE: {{SOLICITATION_NUMBER}} - {{OPPORTUNITY_TITLE}}
</div>

<p>Dear {{AGENCY_NAME}} Contracting Officer,</p>

<p>
  {{COMPANY_NAME}} is pleased to submit this proposal in response to
  solicitation {{SOLICITATION_NUMBER}}, "{{OPPORTUNITY_TITLE}}".
  We understand the critical importance of this requirement to {{AGENCY_NAME}}'s mission.
</p>

{{CONTENT}}

<p>
  This proposal is valid through {{CURRENT_MONTH}} {{CURRENT_DAY}}, {{CURRENT_YEAR}}.
  We look forward to the opportunity to support {{AGENCY_NAME}}.
</p>

<div style="margin-top: 3em;">
  Sincerely,<br><br><br>
  [Signature]<br>
  [Name], [Title]<br>
  {{COMPANY_NAME}}
</div>

</body>
</html>
```

---

## Notes

1. **Case Sensitive**: Variable names are case-sensitive and must be in ALL CAPS.

2. **Missing Data**: If a variable's data is not available (e.g., no NAICS code in the opportunity), it will be replaced with an empty string.

3. **Date Formatting**: Date variables are automatically formatted for readability. ISO dates from the database are converted to "Month Day, Year" format.

4. **Currency Formatting**: Financial variables are automatically formatted as US currency with commas and no decimal places.

5. **HTML Safety**: All variable values are HTML-escaped to prevent injection attacks.

---

## Implementation Details

The template variable system is implemented in:
- **Backend**: `apps/functions/src/helpers/document-generation.ts` (buildMacroValues function)
- **Data Sources**: Organization, Project, and Opportunity entities from DynamoDB
- **Replacement**: Happens during AI scaffold preparation and final document generation

---

## Adding New Variables

To add a new template variable:

1. Add the variable label to `MACRO_LABELS` in `document-generation.ts`
2. Add the variable population logic to `buildMacroValues()` function
3. Update this documentation file
4. Consider if the variable needs to be added to the Project, Organization, or Opportunity schema

---

## Removed Variables

The following variables were removed because they don't map to fields in the data schemas:

- `{{CONTRACT_NUMBER}}` - Not available in project schema. If needed, should be stored in the opportunity or project custom fields.
- `{{PAGE_LIMIT}}` - Not available in project schema. Page limits should be extracted from the solicitation requirements section.
- `{{CONTRACT_TYPE}}` - Replaced with `{{OPPORTUNITY_TYPE}}` which maps to the actual opportunity type field.

---

*Last Updated: 2026-03-06*
