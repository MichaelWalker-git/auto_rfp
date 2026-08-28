import { test, expect } from './fixtures/auth';

/**
 * Solution Plan version history e2e (solution-plan-versioning) — runs against
 * a REAL environment (deployed dev backend + this branch's frontend), no
 * mocked backend, mirroring solution-plan.auth.spec.ts:
 *
 *   PLAYWRIGHT_BASE_URL=...             frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD  real Cognito login
 *   E2E_SP_VERSIONS_OPP_PATH            opportunity WITH an existing READY
 *                                       solution plan (restore is disabled
 *                                       while a plan is generating, so don't
 *                                       point this at the happy-path
 *                                       opportunity a generation test churns)
 *
 * Paths look like /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}.
 * Tests skip when the env var is unset, mirroring the E2E_TEST_EMAIL auto-skip.
 *
 * Intentional partial cleanup (same stance as the solution-plan spec): the
 * lifecycle test deletes the throwaway version it created, but leaves one
 * short marker paragraph appended to the plan and a few extra history rows.
 * Versions self-prune at 30 and dev plans are routinely regenerated.
 */

const VERSIONS_OPP_PATH = process.env.E2E_SP_VERSIONS_OPP_PATH;

const EDITOR_PATH_SUFFIX = '/solution-plan/edit';

test.describe('Solution Plan version history — read-only surfaces', () => {
  test.skip(!VERSIONS_OPP_PATH, 'E2E_SP_VERSIONS_OPP_PATH not set');

  test('header dropdown, history panel, and read-only view of the current version', async ({
    page,
    versionsPage,
  }) => {
    test.setTimeout(180_000);

    // The version list is fetched as the plan panel mounts — capture it so
    // assertions use the backend's own versionIds and currentVersionId.
    const { versions, currentVersionId } = await versionsPage.captureVersionList(
      async () => {
        await page.goto(VERSIONS_OPP_PATH!);
      },
    );

    // Precondition on dev data: the opportunity must have a plan (the
    // version control replaces the static "Version {n}" text on its panel).
    await expect(
      versionsPage.dropdownTrigger,
      'no Solution Plan panel with a version control — point E2E_SP_VERSIONS_OPP_PATH at an opportunity with a READY plan',
    ).toBeVisible({ timeout: 30_000 });

    if (versions.length === 0) {
      // Pre-feature plan with no captured versions yet: empty explanation
      // in the dropdown, empty state in the panel.
      await expect(versionsPage.dropdownTrigger).toContainText('No versions yet');
      await versionsPage.openHistoryPanel();
      await expect(versionsPage.emptyState).toBeVisible();
      return;
    }

    // The newest history record is the current version (AC list ordering).
    expect(currentVersionId).toBe(versions[0].versionId);
    await expect(versionsPage.dropdownTrigger).toContainText('Current');

    // Dropdown shows up to 5 recent versions + "See all versions".
    await versionsPage.openDropdown();
    for (const version of versions.slice(0, 5)) {
      await expect(versionsPage.dropdownItem(version.versionId)).toBeVisible();
    }
    await expect(
      versionsPage.dropdownItem(currentVersionId!).getByText('Current'),
    ).toBeVisible();

    // Full history panel lists every version, current row marked.
    await versionsPage.seeAllItem.click();
    await expect(versionsPage.historyPanel).toBeVisible();
    for (const version of versions) {
      await expect(versionsPage.versionRow(version.versionId)).toBeVisible();
    }
    await expect(
      versionsPage.versionRow(currentVersionId!).getByText('Current'),
    ).toBeVisible();

    // The current version's read-only view: content loads, and the footer
    // offers Close + Rename only — no Restore/Delete on current (AC4.1.8).
    await versionsPage.openRowActions(currentVersionId!);
    const [contentResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/solution-plan/version/content') &&
          res.request().method() === 'GET',
        { timeout: 60_000 },
      ),
      versionsPage.rowAction('view', currentVersionId!).click(),
    ]);
    expect(contentResponse.status()).toBe(200);

    await expect(versionsPage.viewBanner).toContainText('read-only');
    await expect(versionsPage.viewClose).toBeVisible();
    await expect(versionsPage.viewRename).toBeVisible();
    await expect(versionsPage.viewRestore).not.toBeVisible();
    await expect(versionsPage.viewDelete).not.toBeVisible();

    await versionsPage.viewClose.click();
    await expect(versionsPage.viewBanner).not.toBeVisible();
  });
});

test.describe('Solution Plan version history — capture, label, restore, delete', () => {
  test.skip(!VERSIONS_OPP_PATH, 'E2E_SP_VERSIONS_OPP_PATH not set');

  test('manual save captures a version; label, restore-as-new, and delete work end-to-end', async ({
    page,
    versionsPage,
  }) => {
    test.setTimeout(10 * 60_000);

    const runId = Date.now().toString(36);
    const markerA = `E2E versions marker A ${runId}`;
    const markerB = `E2E versions marker B ${runId}`;

    const editor = page.locator('.ProseMirror').first();

    /** Append a paragraph at the end of the plan and Save (PATCH …/update). */
    const appendAndSave = async (text: string): Promise<void> => {
      await expect(editor).toBeVisible({ timeout: 60_000 });
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(text);
      const [saveResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes('/solution-plan/update') &&
            res.request().method() === 'PATCH',
          { timeout: 60_000 },
        ),
        page.getByRole('button', { name: /^save$/i }).click(),
      ]);
      expect(saveResponse.status()).toBe(200);
    };

    // ── 1. Manual save captures a version credited to the caller ──
    await page.goto(`${VERSIONS_OPP_PATH}${EDITOR_PATH_SUFFIX}`);
    const before = await versionsPage.captureVersionList(async () => {
      // The editor toolbar mounts the version control, which fetches the list.
      await expect(versionsPage.dropdownTrigger).toBeVisible({ timeout: 60_000 });
    });

    await appendAndSave(markerA);

    // Reload: the list refetches; the new current version is a manual save.
    const afterSaveA = await versionsPage.captureVersionList(async () => {
      await page.reload();
    });
    expect(afterSaveA.versions.length).toBeGreaterThan(before.versions.length);
    expect(afterSaveA.currentVersionId).not.toBe(before.currentVersionId);
    const versionA = afterSaveA.versions[0];
    expect(versionA.versionId).toBe(afterSaveA.currentVersionId);
    expect(versionA.origin).toBe('manual-save');
    // Attribution: a real caller, never the SYSTEM sentinel.
    expect(versionA.createdByName).not.toBe('System');

    // ── 2. Label the version inline (Enter saves; shown quoted in the row) ──
    const label = `e2e label ${runId}`;
    await versionsPage.openHistoryPanel();
    await versionsPage.openRowActions(versionA.versionId);
    await versionsPage.rowAction('rename', versionA.versionId).click();
    await versionsPage.saveLabel(label);
    await expect(versionsPage.rowLabel(versionA.versionId)).toContainText(label);
    await page.keyboard.press('Escape'); // close the panel

    // ── 3. Second save makes version A non-current ──
    await appendAndSave(markerB);
    const afterSaveB = await versionsPage.captureVersionList(async () => {
      await page.reload();
    });
    const versionB = afterSaveB.versions[0];
    expect(versionB.versionId).toBe(afterSaveB.currentVersionId);
    expect(versionB.versionId).not.toBe(versionA.versionId);

    // ── 4. Restore version A — restore-as-new, nothing lost ──
    await versionsPage.openHistoryPanel();
    await versionsPage.openRowActions(versionA.versionId);
    await versionsPage.rowAction('restore', versionA.versionId).click();
    await versionsPage.confirmRestore();
    await page.keyboard.press('Escape');

    // The editor re-hydrates with the restored content: marker A, no marker B.
    await expect(editor.getByText(markerA)).toBeVisible({ timeout: 60_000 });
    await expect(editor.getByText(markerB)).not.toBeVisible();

    // The restore itself was captured as the new current version, and both
    // prior versions (A and B) are still in the history.
    const afterRestore = await versionsPage.captureVersionList(async () => {
      await page.reload();
    });
    const restoredCurrent = afterRestore.versions[0];
    expect(restoredCurrent.versionId).toBe(afterRestore.currentVersionId);
    expect(restoredCurrent.origin).toBe('restore');
    const versionIds = afterRestore.versions.map((version) => version.versionId);
    expect(versionIds).toContain(versionA.versionId);
    expect(versionIds).toContain(versionB.versionId);

    // ── 5. Delete the throwaway non-current version B ──
    await versionsPage.openHistoryPanel();
    await versionsPage.openRowActions(versionB.versionId);
    await versionsPage.rowAction('delete', versionB.versionId).click();
    await versionsPage.confirmDelete();
    await expect(versionsPage.versionRow(versionB.versionId)).not.toBeVisible();

    // The current version never offers Delete… (guarded server-side by 409).
    await versionsPage.openRowActions(afterRestore.currentVersionId!);
    await expect(
      versionsPage.rowAction('delete', afterRestore.currentVersionId!),
    ).not.toBeVisible();
  });
});
