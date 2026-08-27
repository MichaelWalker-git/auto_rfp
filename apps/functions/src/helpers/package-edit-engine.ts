/**
 * Package-edit proposal engine (async worker).
 *
 * Runs the agentic tool-use loop against the whole package. The MODEL's job is
 * only to decide WHAT changes — it returns {find, replace} pairs (the exact
 * current value and its replacement). The BACKEND owns recall: it scans every
 * document + every form field for each `find` and emits one guarded proposal per
 * occurrence. This decouples judgment (model) from recall (deterministic scan)
 * and removes the fragile "reproduce an exact before that matches the stripped
 * HTML" step that could return 0 proposals or miss occurrences.
 *
 * No writes happen here — the apply handler does the guarded write later.
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { invokeClaudeWithTools } from '@/helpers/bedrock-tool-loop';
import {
  COMPLIANCE_REVIEW_TOOLS,
  makeComplianceToolExecutor,
  buildPackageInventory,
  type PackageInventory,
} from '@/helpers/compliance-review-tools';
import { loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { stripHtml } from '@/helpers/compliance-review-html';
import {
  readQuestionnaireCellInventory,
  type QuestionnaireCell,
} from '@/helpers/compliance-review-xlsx';
import {
  findDocumentOccurrences,
  replaceInFieldValue,
  safeCompileRegex,
  findRegexOccurrences,
  findRegexInFieldValue,
} from '@/helpers/package-edit-occurrences';
import { MAX_TOKENS_PROPOSE, MAX_TOOL_ROUNDS_PROPOSE } from '@/constants/package-edit';
import type { ProposedEdit } from '@auto-rfp/core';

// ─── Model output schema ─────────────────────────────────────────────────────
//
// The model identifies WHAT changes — the exact current value(s) and their
// replacement. It does NOT enumerate occurrences or reproduce surrounding
// context; the backend finds every occurrence across the whole package.
//
// `find` accepts EITHER a single string OR an array of strings, because the same
// logical value can exist in the package as MULTIPLE literal variants (e.g. an
// email that a prior edit changed in some spots but not others: "old@x.com" AND
// "interim@x.com" both need to become the new address). Every variant maps to
// the one `replace`.

const StringOrArray = z.union([z.string(), z.array(z.string())]);

const ReplacementSchema = z.object({
  // Literal current value(s) to replace. Optional when a pattern is given.
  find: StringOrArray.optional().default([]),
  // Pattern-based matching for when the value has multiple/unknown literal
  // variants (e.g. "any email near Brennen"). `findRegex` matches by SHAPE;
  // `near` scopes matches to a nearby anchor so we don't change the wrong one.
  findRegex: z.string().optional(),
  near: z.string().optional(),
  replace: z.string(),
  rationale: z.string().default(''),
});
type Replacement = z.infer<typeof ReplacementSchema>;

// A FILL sets the value of a specific form field addressed by formId + fieldId
// (from get_form_fields). Unlike a replacement, it has NO text to "find" — it's
// how an EMPTY field gets populated (find/replace can't target empty text). The
// model names the exact field(s); the backend proposes `before`=current value
// (usually empty) → `after`=value, and the existing form apply guard verifies the
// current value still matches before writing.
const FillSchema = z.object({
  formId: z.string(),
  fieldId: z.string(),
  value: z.string(),
  rationale: z.string().default(''),
});
type Fill = z.infer<typeof FillSchema>;

export const ProposeOutputSchema = z.object({
  answer: z.string().default(''),
  replacements: z.array(ReplacementSchema).default([]),
  fills: z.array(FillSchema).default([]),
});
type ProposeOutput = z.infer<typeof ProposeOutputSchema>;

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a meticulous proposal editor for US federal government contracts.

You are given an EDIT INSTRUCTION and a SUBMISSION PACKAGE (RFP response documents + required forms). Identify what the instruction wants changed. You do NOT apply changes — you propose them for human confirmation. You do NOT need to find every place a value appears: the system automatically finds and updates every occurrence across the whole package.

You can propose two kinds of change:
- REPLACEMENTS — change existing text to a new value (find→replace).
- FILLS — set the value of a specific EMPTY (or wrong) FORM FIELD, addressed by its formId + fieldId. Use this when the instruction asks to FILL IN or ADD a value that is currently MISSING (e.g. "fill the Primary Contact Name" on a form where that field is empty). Find/replace CANNOT populate an empty field (there is no existing text to find), so a missing value MUST be a fill.

HOW TO WORK:
1. Call list_package_documents FIRST to see every RFP document (with headings) and required form (with field counts).
2. Read the ACTUAL current values with get_document_section (RFP docs) and get_form_fields (forms). get_form_fields shows each field's fieldId, label, and current value ("(empty)" when unset).
3. Decide the change:
   - To CHANGE existing text: use a REPLACEMENT. If the value is a fixed known string (or a few known variants), use "find" (a string or array of exact current strings copied verbatim). If it's a TYPED value that may appear in several forms you can't fully enumerate (an email, phone, dollar amount), use "findRegex" (a JS regex matching that shape) plus "near" (a nearby anchor word/name that scopes WHICH one to change).
   - To FILL a missing/empty form field: use a FILL with the exact formId + fieldId from get_form_fields and the new "value". Only fill fields the instruction actually calls for (e.g. only fields whose current value is empty when asked to "fill missing" ones).

OUTPUT FORMAT — return ONLY a JSON object, no markdown fences, no prose outside it:
{
  "answer": "<short human summary of what you will change>",
  "replacements": [
    {
      // Use find OR findRegex (findRegex preferred for emails/phones/amounts):
      "find": ["<exact current value>", "<other exact variant if known>"],
      "findRegex": "<JS regex matching the value's shape, e.g. an email pattern>",
      "near": "<anchor that scopes the match, e.g. the person's name 'Brennen'>",
      "replace": "<the new value>",
      "rationale": "<one short line: why this change>"
    }
  ],
  "fills": [
    {
      "formId": "<exact formId from list_package_documents>",
      "fieldId": "<exact fieldId from get_form_fields>",
      "value": "<the value to set>",
      "rationale": "<one short line: why this change>"
    }
  ]
}

CRITICAL RULES:
- To set a value that is currently MISSING/empty, you MUST use "fills" (not a replacement). Find/replace only edits existing text, so it silently matches nothing on an empty field.
- fills MUST use an exact formId + fieldId returned by get_form_fields — never invent them. Read the form's fields first to get the ids and to confirm the field is empty/wrong.
- Prefer "findRegex" + "near" for emails, phone numbers, and monetary amounts — this catches EVERY current variant of the value. Example for Brennen's email: findRegex "[\\\\w.+-]+@[\\\\w.-]+\\\\.[A-Za-z]{2,}", near "Brennen".
- ALWAYS include "near" when using findRegex, so only the intended value is changed (conservative matching drops matches with no anchor nearby).
- Keep regex SIMPLE and specific; never use ".*" or ".+" alone. Do not try to match a whole sentence.
- "find" values (when used) MUST be copied verbatim from tool output — never paraphrase or invent.
- One replacement per distinct target value; one fill per field. Only propose changes the instruction actually calls for.
- Your FINAL message MUST be the JSON object. If nothing needs changing, return empty replacements and fills arrays with a brief answer. Never end with "Let me look...": either call a tool or output the JSON.`;

const buildUserPrompt = (instruction: string): string =>
  `EDIT INSTRUCTION: "${instruction}"\n\n` +
  `Read the package with the tools, then output the change(s). To CHANGE existing text use a replacement ` +
  `(for a typed value like an email, phone, or amount, prefer "findRegex" + "near" so every current variant ` +
  `is caught). To FILL a missing/empty form field, read the form with get_form_fields and output a "fill" ` +
  `with the exact formId + fieldId — find/replace cannot populate an empty field. The system deterministically ` +
  `applies each change across the package under human review.`;

// ─── Deterministic expansion (backend owns recall) ──────────────────────────

const normalizeHaystack = (text: string): string => text.replace(/\s+/g, ' ');

/**
 * Expand the model's {find, replace} pairs into one guarded proposal per real
 * occurrence across the WHOLE package (every document + every form field), and
 * turn each {formId, fieldId, value} fill into a guarded set-value proposal for
 * that field. The backend — not the model — guarantees recall: a value that
 * appears N times yields N proposals no matter what the model happened to read.
 * A `find` that matches nothing (or a fill naming an unknown field) is reported
 * in `unmatched`.
 */
const expandReplacements = async (
  replacements: Replacement[],
  fills: Fill[],
  inventory: PackageInventory,
): Promise<{ proposals: ProposedEdit[]; unmatched: string[] }> => {
  const docTextCache = new Map<string, string>();
  // Full (untruncated) questionnaire cells, re-read from S3 per document. The
  // inventory's `questionnaireCells` are truncated to 300 chars for the model
  // prompt; using those as a proposal's `before` would never match the apply
  // guard (which compares full cell text) for long cells, and would miss a `find`
  // occurring past char 300. So scan the full values here.
  const fullCellsCache = new Map<string, QuestionnaireCell[]>();
  const out: ProposedEdit[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];

  const pushEdit = (edit: ProposedEdit, dedupKey: string) => {
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    out.push(edit);
  };

  // Atomic targets (form fields / questionnaire cells) apply as a WHOLE-value
  // overwrite, so several replacements to the SAME target must COMPOSE into one
  // before→after. Keying dedup on target-only would otherwise drop every edit
  // past the first (same key) — silently, since `hits` was already counted — and
  // the user would believe all applied. We instead fold each further transform
  // onto the running `after` of the already-emitted edit for that target.
  const atomicEditIndex = new Map<string, number>();

  const mergeNotes = (existing: string, incoming: string): string =>
    !incoming || existing === incoming || existing.includes(incoming)
      ? existing
      : `${existing}; ${incoming}`;

  /**
   * Emit-or-compose one atomic-target edit. `transform` maps a base value to its
   * edited form; on the first edit for `key` it runs against `originalValue`, and
   * on every subsequent edit it runs against the running `after` so the changes
   * stack. A transform that changes nothing is skipped (never emits a no-op).
   */
  const pushAtomic = (
    key: string,
    originalValue: string,
    transform: (base: string) => string,
    note: string,
    makeEdit: (before: string, after: string) => ProposedEdit,
  ) => {
    const existingIdx = atomicEditIndex.get(key);
    if (existingIdx !== undefined) {
      const prev = out[existingIdx];
      const nextAfter = transform(prev.after);
      if (nextAfter === prev.after) return; // this change adds nothing on top
      prev.after = nextAfter;
      prev.rationale = mergeNotes(prev.rationale, note);
      return;
    }
    const after = transform(originalValue);
    if (after === originalValue) return; // no-op — nothing to propose
    atomicEditIndex.set(key, out.length);
    out.push(makeEdit(originalValue, after));
  };

  // Untruncated cells for a questionnaire doc (re-read from S3, cached). Falls
  // back to the inventory's (truncated) cells if the file can't be re-read, so a
  // transient S3 hiccup degrades to the old behaviour rather than dropping the doc.
  const getFullCells = async (
    doc: PackageInventory['documents'][number],
  ): Promise<QuestionnaireCell[]> => {
    const cached = fullCellsCache.get(doc.documentId);
    if (cached) return cached;
    let cells = doc.questionnaireCells?.cells ?? [];
    if (doc.fileKey) {
      const full = await readQuestionnaireCellInventory(doc.fileKey, { maxCellChars: Infinity }).catch(
        () => null,
      );
      if (full) cells = full.cells;
    }
    fullCellsCache.set(doc.documentId, cells);
    return cells;
  };

  const getDocText = async (doc: PackageInventory['documents'][number]): Promise<string> => {
    let text = docTextCache.get(doc.documentId);
    if (text === undefined) {
      try {
        text = normalizeHaystack(stripHtml(await loadRFPDocumentHtml(doc.htmlContentKey!)));
      } catch {
        text = '';
      }
      docTextCache.set(doc.documentId, text);
    }
    return text;
  };

  const pushDoc = (
    doc: PackageInventory['documents'][number],
    before: string,
    after: string,
    note: string,
  ) =>
    pushEdit(
      {
        editId: uuidv4(),
        target: { kind: 'RFP_DOCUMENT', documentId: doc.documentId, documentTitle: doc.title },
        before,
        after,
        rationale: note,
        advisoryOnly: false,
      },
      `doc:${doc.documentId}:${before}`,
    );

  const pushForm = (
    form: PackageInventory['forms'][number],
    field: PackageInventory['forms'][number]['fields'][number],
    transform: (base: string) => string,
    note: string,
  ) =>
    pushAtomic(
      `form:${form.formId}:${field.fieldId}`,
      field.value ?? '',
      transform,
      note,
      (before, after) => ({
        editId: uuidv4(),
        target: {
          kind: 'FORM',
          formId: form.formId,
          formTitle: form.name,
          fieldId: field.fieldId,
          fieldLabel: field.label,
        },
        before,
        after,
        rationale: note,
        advisoryOnly: false,
      }),
    );

  const pushQuestionnaire = (
    doc: PackageInventory['documents'][number],
    cell: { row: number; col: number; ref: string; value: string },
    transform: (base: string) => string,
    note: string,
  ) =>
    pushAtomic(
      `q:${doc.documentId}:${cell.ref}`,
      cell.value,
      transform,
      note,
      (before, after) => ({
        editId: uuidv4(),
        target: {
          kind: 'QUESTIONNAIRE',
          documentId: doc.documentId,
          documentTitle: doc.title,
          sheetName: doc.questionnaireCells!.sheetName,
          row: cell.row,
          col: cell.col,
          ref: cell.ref,
        },
        before,
        after,
        rationale: note,
        advisoryOnly: false,
      }),
    );

  // Literal find/replace pass. Dedup identical pairs so two entries don't double-scan.
  const pairs = new Map<string, { find: string; replace: string; rationale: string }>();
  for (const r of replacements) {
    const finds = Array.isArray(r.find) ? r.find : r.find ? [r.find] : [];
    for (const raw of finds) {
      const find = (raw ?? '').trim();
      if (!find || find === r.replace) continue;
      pairs.set(`${find}=>${r.replace}`, { find, replace: r.replace, rationale: r.rationale });
    }
  }
  for (const { find, replace, rationale } of pairs.values()) {
    let hits = 0;
    const note = rationale?.trim() || `Replace "${find}" with "${replace}"`;
    for (const doc of inventory.documents) {
      if (!doc.htmlContentKey) continue;
      for (const occ of findDocumentOccurrences(await getDocText(doc), find, replace)) {
        hits++;
        pushDoc(doc, occ.before, occ.after, note);
      }
    }
    for (const form of inventory.forms) {
      for (const field of form.fields) {
        const value = field.value ?? '';
        if (!value.includes(find)) continue;
        hits++;
        pushForm(form, field, (base) => replaceInFieldValue(base, find, replace), note);
      }
    }
    // XLSX questionnaire cells (atomic units, like form fields). Scan the FULL
    // untruncated cell values so long cells match on apply and a `find` past the
    // review-truncation cutoff is still caught.
    for (const doc of inventory.documents) {
      if (!doc.questionnaireCells) continue;
      for (const cell of await getFullCells(doc)) {
        if (!cell.value.includes(find)) continue;
        hits++;
        pushQuestionnaire(doc, cell, (base) => replaceInFieldValue(base, find, replace), note);
      }
    }
    if (hits === 0) unmatched.push(find);
  }

  // Regex + anchor pass (typed values with multiple/unknown variants).
  // Conservative: when `near` is set, matches without the anchor nearby are dropped.
  for (const r of replacements) {
    if (!r.findRegex) continue;
    const re = safeCompileRegex(r.findRegex);
    if (!re) {
      unmatched.push(`/${r.findRegex}/ (invalid or too broad)`);
      continue;
    }
    const note =
      r.rationale?.trim() || `Replace ${r.near ? `${r.near}'s ` : ''}value with "${r.replace}"`;
    let hits = 0;
    for (const doc of inventory.documents) {
      if (!doc.htmlContentKey) continue;
      for (const mm of findRegexOccurrences(await getDocText(doc), re, r.replace, r.near)) {
        if (r.near && !mm.anchored) continue;
        hits++;
        pushDoc(doc, mm.before, mm.after, note);
      }
    }
    for (const form of inventory.forms) {
      for (const field of form.fields) {
        const value = field.value ?? '';
        const res = findRegexInFieldValue(value, re, r.replace, r.near, field.label);
        if (!res.matchedAny) continue;
        if (r.near && !res.anchored) continue;
        hits++;
        pushForm(
          form,
          field,
          (base) => findRegexInFieldValue(base, re, r.replace, r.near, field.label).after,
          note,
        );
      }
    }
    // XLSX questionnaire cells (full untruncated values — see literal pass). A
    // cell has no label, so the anchor is checked against the cell value only
    // (conservative: unanchored matches dropped when `near` is set).
    for (const doc of inventory.documents) {
      if (!doc.questionnaireCells) continue;
      for (const cell of await getFullCells(doc)) {
        const res = findRegexInFieldValue(cell.value, re, r.replace, r.near);
        if (!res.matchedAny) continue;
        if (r.near && !res.anchored) continue;
        hits++;
        pushQuestionnaire(
          doc,
          cell,
          (base) => findRegexInFieldValue(base, re, r.replace, r.near).after,
          note,
        );
      }
    }
    if (hits === 0) unmatched.push(`/${r.findRegex}/${r.near ? ` near "${r.near}"` : ''}`);
  }

  // Fill pass (set an addressed form field's value). This is the ONLY path that
  // can populate an empty field — find/replace has no text to match on one. The
  // proposal's `before` is the field's CURRENT value (usually empty); the form
  // apply guard re-verifies it before writing, so a field edited since the scan
  // is safely skipped. A no-op (value already equals target) is dropped; an
  // unknown formId/fieldId is reported unmatched.
  for (const fill of fills) {
    const form = inventory.forms.find((f) => f.formId === fill.formId);
    const field = form?.fields.find((fl) => fl.fieldId === fill.fieldId);
    if (!form || !field) {
      unmatched.push(`field ${fill.fieldId} on form ${fill.formId} (not found)`);
      continue;
    }
    const current = field.value ?? '';
    if (current === fill.value) continue; // already set to the target — nothing to do
    const note =
      fill.rationale?.trim() || `Set "${field.label}" to "${fill.value}"`;
    // A fill is an absolute set: it ignores the running value and wins, so it
    // composes correctly over any earlier replacement to the same field.
    pushForm(form, field, () => fill.value, note);
  }

  return { proposals: out, unmatched };
};

// ─── Public API ────────────────────────────────────────────────────────────────

export interface ProposeResult {
  answer: string;
  proposals: ProposedEdit[];
  /** find-tokens the model proposed that matched nothing in the package. */
  unmatched: string[];
  /** how many distinct replacements the model proposed (before expansion). */
  requested: number;
}

/**
 * Scan the package and draft proposals for one edit instruction.
 * Sonnet-class model, higher round/token budget (async worker — no 29s limit).
 */
export const runProposeEdits = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  instruction: string;
  inventory?: PackageInventory;
}): Promise<ProposeResult> => {
  const { orgId, projectId, oppId, modelId, instruction } = args;

  const inventory = args.inventory ?? (await buildPackageInventory({ orgId, projectId, oppId }));
  const executor = makeComplianceToolExecutor({ orgId, oppId, projectId, inventory });

  const output = await invokeClaudeWithTools<ProposeOutput>({
    modelId,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(instruction),
    tools: COMPLIANCE_REVIEW_TOOLS,
    toolExecutor: executor,
    outputSchema: ProposeOutputSchema,
    maxTokens: MAX_TOKENS_PROPOSE,
    maxToolRounds: MAX_TOOL_ROUNDS_PROPOSE,
  });

  const replacements = (output.replacements ?? []) as Replacement[];
  const fills = (output.fills ?? []) as Fill[];
  const { proposals, unmatched } = await expandReplacements(replacements, fills, inventory);
  return {
    answer: output.answer,
    proposals,
    unmatched,
    requested: replacements.length + fills.length,
  };
};
