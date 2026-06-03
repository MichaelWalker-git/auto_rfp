# RFP Document Generation — Dev Environment Investigation

> **Status:** 🔬 Investigation complete — fixes deferred ("back in future")
> **Date:** 2026-06-03
> **Environment:** dev (`stage=Dev`)
> **Reporter:** developer feedback — production fine, dev broken

---

## 1. Reported Symptoms (dev only)

1. **Documents won't generate when some tools/sections are empty.**
2. **Document title shows the project title** (e.g. the project name) **instead of the document type** (e.g. "Technical Proposal").
3. **Title page missing** for some generated documents.

Production generates RFP documents fine — the issues are dev-specific.

---

## 2. How the investigation was done

- Read the generation code paths in `apps/functions`.
- Traced full runs in CloudWatch: `/aws/lambda/auto-rfp-doc-gen-worker-Dev`.
- Inspected the offending template in S3.

**Key files:**

| File | Role |
|---|---|
| `apps/functions/src/helpers/generate-document-worker.ts` | Core generation logic; `extractDocumentTitle` (L124), `processJobInner` (L592), final assembly (L740+) |
| `apps/functions/src/helpers/document-section-generator.ts` | Section-by-section generation; empty-section fallback (L540–557) |
| `apps/functions/src/helpers/document-generation.ts` | `validateGeneratedContent` — min 100 chars (`MIN_CONTENT_LENGTH`) |
| `apps/functions/src/handlers/rfp-document/generate-document-worker.ts` | SQS worker + retry/permanent-fail logic |

**Affected document IDs in dev (last 3 days):** `1ce03165`, `727db691`, `97afae39`, `fa0baad2` (all `TECHNICAL_PROPOSAL`, org `9c0a5757-e2da-4e71-9490-01c558f7ffc3`).

---

## 3. Root cause — the dev test template

All three symptoms share one root cause: the dev template **"Test Tech Proposal"**
(`templates/9c0a5757-.../47aecd97-7fb2-4e03-b978-3bfc9ba20340/content.html`, 872 chars), combined with an empty dev knowledge base.

Template content (verbatim):

```html
<img ... top logo>
<p></p><p></p><p></p>
<h2>{{PROJECT_TITLE}}</h2>
<p><span style="color: rgb(209,139,48);">{{TODAY}}</span></p>
<p></p><p></p><p></p><p></p>
<img ... bottom logo>
<div data-page-break="true" style="break-after: page;"></div>
<p>{{CONTENT}}</p>
```

Problems with this template:
- The only prominent heading is `<h2>{{PROJECT_TITLE}}</h2>` — there is **no `<h1>`** and **no document-type label**.
- Section parsing splits it into 2 sections: `"Introduction"` (pre-heading logos) and a junk section whose title resolves to **`"Ivan 2"`** (leaked scaffold text + heading), which has **no `[CONTENT:]` placeholder** to fill.

---

## 4. Symptom-by-symptom explanation

### Symptom 1 — Documents won't generate when sections/tools are empty

Trace of doc `1ce03165` (request `675b6e25`):

1. Template → 2 sections: `Introduction` (used directly) + `Ivan 2`.
2. For `Ivan 2`, AI calls tools; `search_knowledge_base` repeatedly returns **54 chars** (empty result — dev KB unpopulated for this org).
3. AI returns an **empty response** → falls back to template content (also empty).
4. Stitched doc = **16 chars** → fails `validateGeneratedContent` (min 100).
5. Falls back to single-shot generation → AI returns **0 chars** → minimal HTML fallback (82 chars) → after stripping = **34 chars** → fails validation again.
6. Retries 3× (`enqueueRetry`) → `marked as permanently FAILED`.

**Root cause:** when the KB/tools return nothing **and** the template section has no real placeholder content, every generation path produces empty output and the document fails the 100-char minimum.

### Symptom 2 — Title is the project title, not "Technical Proposal"

`extractDocumentTitle` (`generate-document-worker.ts:124`) reads the document title from the template's **first `<h1>`**. This template has **no `<h1>`** — only `<h2>{{PROJECT_TITLE}}</h2>`.

- The metadata title sometimes resolves correctly (single-shot path logged `title="Technical Proposal"`), **but** the body's visible heading is `<h2>{{PROJECT_TITLE}}</h2>` → renders the **project title** on the page.
- The code has no rule that the document *type* should win over a template heading that resolves to the project title.

### Symptom 3 — Missing title page on some documents

The "title page" is whatever the template places above the first page break (logos + heading block). When generation fails and drops to the minimal-HTML / single-shot fallback, the template-header-preserving assembly path is skipped or produces a stripped 34–82 char doc. So:
- Docs that fail validation never get a proper title page.
- Docs that squeak through single-shot get an inconsistent header depending on which injection branch ran.

---

## 5. Why production is unaffected

- Production uses real templates with a proper `<h1>` / document-type title and a real `{{CONTENT}}` placeholder.
- Production knowledge base is populated, so tools return content and the AI produces a full body.

This is **dev test data**, not a production regression.

---

## 6. Recommended fixes

Priority order:

1. **Template fix (immediate, unblocks the reporter — S3/Dynamo data, not code):** <!-- ⏳ PENDING -->
   Replace the dev "Test Tech Proposal" template so it has a proper `<h1>` document title (or document-type label) and a real `{{CONTENT}}` / `[CONTENT:]` placeholder section, and remove the stray `"Ivan 2"` empty section. This alone resolves all three symptoms for the reporter.

2. **Code hardening — title.** <!-- ✅ IMPLEMENTED -->
   Added `ensureDocumentTitleHeading()` in `generate-document-worker.ts`, called in Step 6c (just before validation). When the assembled content has no `<h1>`, it prepends one built from the document-type label (e.g. "Technical Proposal"), reusing the template's `<h1>` style when available. No-ops when an `<h1>` already exists. Fixes symptoms 2 & 3 for *all* orgs, not just the dev test data.

3. **Code hardening — won't-generate-when-tools-empty (symptom 1).** <!-- ✅ IMPLEMENTED -->
   Root cause: in `generateWithTemplateSections`, when the KB/tools return nothing and a section has no real `[CONTENT:]` placeholder, every section falls back to (empty) template content. The stitched doc came out near-empty (~16 chars) but **non-null**, so the `if (!finalDocument)` single-shot fallback in `processJobInner` never ran — the doomed doc went straight to validation, failed the 100-char minimum, and burned all 3 retries (the KB never populates between retries) → permanent FAIL.
   Fix: after stitching, run the same `validateGeneratedContent` gate; if it fails, return `null` so the **single-shot path gets a chance** — single-shot can still write a real body from the solicitation + Q&A even with an empty knowledge base. Tests cover both the near-empty (→ null/fallback) and real-content (→ document) cases.

4. **Code hardening — title.** <!-- ✅ IMPLEMENTED -->
   Added `ensureDocumentTitleHeading()`, called in Step 6c (just before validation). When the assembled content has no `<h1>`, it prepends one built from the document-type label (e.g. "Technical Proposal"), reusing the template's `<h1>` style when available. No-ops when an `<h1>` already exists. Fixes symptoms 2 & 3 for *all* orgs.

5. **Code hardening — template health check (diagnostics).** <!-- ✅ IMPLEMENTED -->
   Added `assessTemplateHealth()`, called right after the scaffold resolves. Logs an actionable warning up front when a template can't produce content (no `{{CONTENT}}`/`[CONTENT:]` placeholder, no `<h1>`) — so the real cause is visible in CloudWatch instead of a cryptic "content too short". Tests: `generate-document-worker.test.ts` (11 cases total).

---

## 7. Reproduction / verification notes for next session

- Log group: `/aws/lambda/auto-rfp-doc-gen-worker-Dev` (region `us-east-1`, account `039885961427`).
- Useful filter patterns: `"Content validation failed"`, `"empty AI response"`, `"marked as permanently FAILED"`, `"Final document: title"`.
- Template object: `s3://auto-rfp-documents-dev-039885961427/templates/9c0a5757-e2da-4e71-9490-01c558f7ffc3/47aecd97-7fb2-4e03-b978-3bfc9ba20340/content.html`.
- Org under test: `9c0a5757-e2da-4e71-9490-01c558f7ffc3`; project `38e94a22-3181-44bf-a5c3-e7184083789a`.
