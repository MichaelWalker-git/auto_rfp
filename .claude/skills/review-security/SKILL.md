---
name: review-security
description: Security review of changed code - XSS, ReDoS, injection, information leakage, input sanitization
---

# Security Review

Audit changed code for security vulnerabilities, focusing on OWASP Top 10 and web-specific threats.

## Process

1. Get the diff: `git diff develop...HEAD`
2. Check each category below

### XSS (Cross-Site Scripting)
- Is user-generated HTML rendered without sanitization?
- Are heading texts, document titles, or user content injected into HTML templates?
- Does the `escapeHtml` function cover all necessary characters?
- Are `innerHTML` or `dangerouslySetInnerHTML` used with unsanitized content?
- Check: do HTML builder functions escape `<`, `>`, `&`, `"`, `'`?

### ReDoS (Regular Expression Denial of Service)
- Flag regexes with:
  - Nested quantifiers: `(a+)+`, `(a*)*`
  - Overlapping alternations: `(a|a)+`
  - `[\s\S]*?` on attacker-controlled input
- Test: could a crafted 100-char input cause >1s matching time?

### Injection
- Are DynamoDB expressions built with string concatenation from user input?
- Are S3 keys constructed from unsanitized user input?
- Are shell commands constructed from user input?

### Information Leakage
- Do error responses expose stack traces, internal paths, or system details?
- Are internal IDs, AWS account info, or infrastructure details in client responses?
- Do PDF/DOCX metadata fields leak server information?

### Input Validation
- Is all user input validated with Zod before use?
- Are file uploads validated (type, size, content)?
- Are URL parameters validated before being used in queries?

### Authentication & Authorization
- Are new endpoints protected by auth middleware?
- Do permission checks cover the new functionality?

## Output

For each finding:
```
**[SEVERITY] Title**
- File: `path:line`
- Vulnerability: [CWE ID if applicable]
- Attack vector: [how an attacker could exploit this]
- Fix: [concrete remediation]
```