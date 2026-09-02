# 01 — Download works for any reader and forces Save As

**What to build:** Any org member with `document:read` sees a Download button on every DocumentCard in the Knowledge Base view. Clicking it saves the file to disk with the document's current name (Unicode names supported via RFC-5987), never opening it inline in the browser tab. Users without `document:read` see no button at all — no disabled-with-tooltip variant.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Download button on `DocumentCard` no longer depends on `createdBy === userSub`; it is gated purely by `document:read` via a permission-aware wrapper (matches the create/delete pattern already on the card).
- [ ] Users without `document:read` see no Download button.
- [ ] Backend `downloadDocument` appends `ResponseContentDisposition: attachment; filename="<ascii-fallback>"; filename*=UTF-8''<rfc5987-encoded current name>` to the `GetObjectCommand` so the presigned URL signs the header. Reuse the existing RFC-5987 encoder already in the repo (grep the `rfp-document/` handlers first).
- [ ] Frontend switches from `window.open(url, '_blank')` to an `<a href download>` click + remove; downloads never open in a new tab.
- [ ] Filename on disk reflects the current DDB `document.name`, so a later rename flows through to the next download without any extra plumbing.
- [ ] Backend Jest test on `downloadDocument`: returned URL carries a `response-content-disposition` reflecting the current DDB name, including the RFC-5987 form for non-ASCII names.
- [ ] RTL test on `DocumentCard`: Download button visible when the current user has `document:read`, hidden when they don't; ownership no longer influences visibility.
