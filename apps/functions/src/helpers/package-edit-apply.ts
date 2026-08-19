/**
 * Guarded, LLM-free apply for confirmed package edits.
 *
 * This is the safety core. Per proposed edit, we re-verify the `before` against
 * the CURRENT content and only then write:
 *   - RFP_DOCUMENT: `before` must occur EXACTLY ONCE in the current HTML. Not
 *     found → skipped-stale; found >1 → skipped-stale ("ambiguous"); else replace
 *     that single occurrence and save via updateRFPDocumentWithContent (auto-versions).
 *   - FORM: the field's current value must equal `before`. Mismatch → skipped-stale;
 *     else snapshot the form (RequiredFormVersion) then updateRequiredForm.
 *
 * Never overwrites content that changed since it was proposed; never guesses an
 * ambiguous match. Any throw on one target → that target's result is 'failed';
 * the loop continues (non-atomic, per-target). Mirrors the compliance snapshot
 * "skip + report, don't clobber" philosophy.
 */
import {
  getRFPDocument,
  loadRFPDocumentHtml,
  updateRFPDocumentWithContent,
} from '@/helpers/rfp-document';
import { getLatestVersionNumber } from '@/helpers/rfp-document-version';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { snapshotFormFields } from '@/helpers/required-form-version';
import { applyHtmlEdit } from '@/helpers/html-edit';
import { writeQuestionnaireCells } from '@/helpers/questionnaire-edit';
import { snapshotQuestionnaire, docBelongsToOrg } from '@/helpers/questionnaire-version';
import type { EditApplyResult, ProposedEdit } from '@auto-rfp/core';

const applyDocumentEdit = async (
  edit: ProposedEdit,
  ctx: { orgId: string; projectId: string; oppId: string; userId: string },
): Promise<EditApplyResult> => {
  if (edit.target.kind !== 'RFP_DOCUMENT') {
    return { editId: edit.editId, status: 'failed', message: 'Not a document target' };
  }
  const { documentId } = edit.target;

  const doc = await getRFPDocument(ctx.projectId, ctx.oppId, documentId);
  if (!doc || !doc.htmlContentKey) {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Document not found or has no content' };
  }

  const html = await loadRFPDocumentHtml(doc.htmlContentKey as string);

  // `before` is verbatim PLAIN text (copied from get_document_section, which
  // returns stripped/decoded/whitespace-collapsed text). Locate it against a
  // normalized plain-text projection of the HTML and rewrite only the mapped raw
  // span, so tags/formatting around the edited value are preserved.
  const edited = applyHtmlEdit(html, edit.before, edit.after);
  if (edited.status === 'not-found') {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Original text no longer present (changed since proposed)' };
  }
  if (edited.status === 'ambiguous') {
    return {
      editId: edit.editId,
      status: 'skipped-stale',
      message: `Ambiguous — matched ${edited.occurrences} spots; not edited to avoid changing the wrong occurrence`,
    };
  }

  const newHtml = edited.html!;

  await updateRFPDocumentWithContent({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    opportunityId: ctx.oppId,
    documentId,
    dto: {
      content: {
        content: newHtml,
        title: doc.title ?? doc.name,
        customerName: doc.content?.customerName,
        opportunityId: ctx.oppId,
        outlineSummary: doc.content?.outlineSummary,
      },
    },
    userId: ctx.userId,
  });

  // updateRFPDocumentWithContent auto-versions but does not return the number;
  // read it back best-effort for the UI.
  let newVersionNumber: number | undefined;
  try {
    newVersionNumber = await getLatestVersionNumber(ctx.projectId, ctx.oppId, documentId);
  } catch {
    newVersionNumber = undefined;
  }

  return { editId: edit.editId, status: 'applied', newVersionNumber };
};

const applyFormEdit = async (
  edit: ProposedEdit,
  ctx: { orgId: string; projectId: string; oppId: string; userId: string },
): Promise<EditApplyResult> => {
  if (edit.target.kind !== 'FORM') {
    return { editId: edit.editId, status: 'failed', message: 'Not a form target' };
  }
  const { formId, fieldId } = edit.target;

  const form = await getRequiredForm({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    opportunityId: ctx.oppId,
    formId,
  });
  if (!form) {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Form not found' };
  }

  const field = (form.fields ?? []).find((f) => f.fieldId === fieldId);
  if (!field) {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Field not found' };
  }
  if ((field.value ?? '') !== edit.before) {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Field value changed since proposed' };
  }

  // History parity: snapshot BEFORE the write so the AI edit is revertible.
  let newVersionNumber: number | undefined;
  try {
    newVersionNumber = await snapshotFormFields({ form, source: 'AI_MASS_EDIT', userId: ctx.userId });
  } catch (snapErr) {
    // Snapshot is best-effort; do not fail the write on a history error.
    console.warn('[package-edit-apply] form snapshot failed (continuing):', (snapErr as Error)?.message);
  }

  const updatedFields = (form.fields ?? []).map((f) =>
    f.fieldId === fieldId ? { ...f, value: edit.after } : f,
  );

  await updateRequiredForm({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    opportunityId: ctx.oppId,
    formId,
    patch: { fields: updatedFields },
  });

  return { editId: edit.editId, status: 'applied', newVersionNumber };
};

const applyQuestionnaireEdit = async (
  edit: ProposedEdit,
  ctx: { orgId: string; projectId: string; oppId: string; userId: string },
): Promise<EditApplyResult> => {
  if (edit.target.kind !== 'QUESTIONNAIRE') {
    return { editId: edit.editId, status: 'failed', message: 'Not a questionnaire target' };
  }
  const { documentId, sheetName, ref } = edit.target;

  const doc = await getRFPDocument(ctx.projectId, ctx.oppId, documentId);
  // Org isolation (M2): getRFPDocument isn't org-scoped in its key, so verify the
  // doc belongs to the run's org before writing its file.
  if (!doc || !doc.fileKey || !docBelongsToOrg(doc, ctx.orgId)) {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Questionnaire not found or has no file' };
  }
  const fileKey = doc.fileKey as string;

  // History parity: snapshot the current .xlsx BEFORE the write (best-effort).
  let newVersionNumber: number | undefined;
  try {
    newVersionNumber = await snapshotQuestionnaire({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      oppId: ctx.oppId,
      documentId,
      currentFileKey: fileKey,
      source: 'AI_MASS_EDIT',
      userId: ctx.userId,
    });
  } catch (snapErr) {
    console.warn('[package-edit-apply] questionnaire snapshot failed (continuing):', (snapErr as Error)?.message);
  }

  const { results } = await writeQuestionnaireCells({
    fileKey,
    writes: [{ ref, sheetName, before: edit.before, after: edit.after }],
  });
  const cell = results[0];
  if (!cell || cell.status === 'skipped-stale') {
    return {
      editId: edit.editId,
      status: 'skipped-stale',
      message: cell?.message ?? 'Cell value changed since proposed',
    };
  }

  return { editId: edit.editId, status: 'applied', newVersionNumber };
};

/** Apply a single edit, converting any throw into a 'failed' result. */
export const applyOneEdit = async (
  edit: ProposedEdit,
  ctx: { orgId: string; projectId: string; oppId: string; userId: string },
): Promise<EditApplyResult> => {
  try {
    switch (edit.target.kind) {
      case 'RFP_DOCUMENT':
        return await applyDocumentEdit(edit, ctx);
      case 'FORM':
        return await applyFormEdit(edit, ctx);
      case 'QUESTIONNAIRE':
        return await applyQuestionnaireEdit(edit, ctx);
    }
  } catch (err) {
    return {
      editId: edit.editId,
      status: 'failed',
      message: (err as Error)?.message ?? 'Unknown error',
    };
  }
};

/** Apply the selected edits from a run, per-target and non-atomic. */
export const applyEdits = async (args: {
  edits: ProposedEdit[];
  orgId: string;
  projectId: string;
  oppId: string;
  userId: string;
}): Promise<EditApplyResult[]> => {
  const { edits, orgId, projectId, oppId, userId } = args;
  const results: EditApplyResult[] = [];
  for (const edit of edits) {
    results.push(await applyOneEdit(edit, { orgId, projectId, oppId, userId }));
  }
  return results;
};
