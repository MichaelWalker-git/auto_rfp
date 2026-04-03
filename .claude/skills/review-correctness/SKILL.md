---
name: review-correctness
description: Deep correctness review of changed code - algorithms, edge cases, error handling, data flow, cross-format consistency
---

# Correctness Review

Review changed files for logical correctness, edge cases, and data integrity.

## Process

1. Get the diff: `git diff develop...HEAD` (or the specified range)
2. For each changed function, verify:

### Algorithm Correctness
- Do regex patterns handle all documented variations? Test mentally with edge inputs.
- Are string operations safe for empty strings, strings with only whitespace, strings with HTML entities?
- Do numeric calculations handle zero, negative, very large values?
- Are array operations safe for empty arrays?

### Edge Cases to Check
| Input type | Example | What to verify |
|---|---|---|
| Empty | `""`, `[]`, `{}`, `null`, `undefined` | No crash, graceful fallback |
| Malformed | Unclosed tags, nested incorrectly, truncated | Reasonable behavior |
| Special chars | `& < > " '`, unicode, emoji, HTML entities | Proper escaping/decoding |
| Large | 1000+ headings, 100+ pages, deeply nested | No performance cliff |
| Missing attributes | HTML without expected `data-*` attrs | Graceful skip |

### Cross-Format Consistency
If the feature produces output in multiple formats (PDF, DOCX, HTML, TXT, MD):
- Is the same data used as input for all formats?
- Are format-specific transformations correct?
- Is the TOC/feature rendered appropriately per format's capabilities?

### State & Lifecycle
- Event listeners: are they cleaned up? (`editor.off` matching `editor.on`)
- React `useEffect` cleanup functions present?
- No stale closures capturing outdated state?

## Output

For each finding:
```
**[SEVERITY] Title**
- File: `path:line`
- Issue: [what's wrong]
- Edge case: [input that triggers the bug]
- Fix: [concrete code change]
```

Severities: CRITICAL (bug), WARNING (potential issue), INFO (improvement)