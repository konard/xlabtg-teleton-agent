---
title: "[AUDIT/V5] Backup restore writes archive entries outside the target root (path traversal / zip-slip)"
labels: ["bug", "audit-finding-v5", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-001"
severity: "high"
category: "security"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/585"
---

## Problem Description

`restoreBackup` writes every file listed in the archive manifest to
`join(root, file.path)` without verifying that the resolved destination stays
inside `root`. `file.path` comes straight from the untrusted archive (the tar
entry names and the manifest are attacker-controlled), so a crafted backup can
contain an entry whose path is `../../etc/cron.d/teleton` or an absolute path,
and `restoreBackup` will happily write it anywhere the process can write. This
is the classic "zip-slip" / tar path-traversal pattern.

The checksum verification in `inspectBackup` does not help — it only proves the
bytes match the manifest's SHA-256; it never constrains where those bytes land.
The archive reader (`parseTar`) also preserves the raw `name` field verbatim.

## Location

- `src/backup/restore.ts:117-127` — restore loop, esp.
  `const destAbs = join(root, file.path);` (`:120`) then
  `writeFileSync(destAbs, data, { mode: 0o600 })` (`:125`), with no containment
  check.
- `src/backup/archive.ts:99` — `parseTar` keeps the raw entry `name`
  (`header.subarray(0, 100)...`), so traversal sequences survive parsing.
- Reached from `src/cli/commands/backup.ts:110`
  (`teleton backup restore <archive>`).

## How To Reproduce

1. Build a `.tar.gz` whose manifest lists a file with
   `path: "../../../../tmp/teleton-pwned"` (and a matching tar entry + correct
   SHA-256).
2. Run `teleton backup restore ./evil.tar.gz`.
3. Observe `/tmp/teleton-pwned` is created outside `TELETON_ROOT`.

## Impact

A malicious or tampered backup archive (e.g. one a user is socially engineered
into restoring, or one fetched from an untrusted location) yields arbitrary file
write with the agent's privileges — overwriting config, dropping a cron unit,
or planting a shell profile. Because the same process holds the TON mnemonic and
integration credentials, this is a full host-compromise primitive.

## Proposed Fix

- Reject any manifest/tar entry whose path is absolute or contains a `..`
  segment before writing anything.
- After `join`, compute `resolve(destAbs)` and assert it is `=== root` or starts
  with `root + sep`; throw otherwise.
- Apply the same containment guard in `inspectBackup` so corruption is detected
  before the safety backup runs and before any write.

## Regression Test

```typescript
it("refuses to restore a backup that escapes the target root", () => {
  const archive = buildArchiveWithEntry("../escape.txt", Buffer.from("x"));
  writeFileSync(archivePath, archive);
  expect(() => restoreBackup({ archivePath, root, skipSafetyBackup: true }))
    .toThrow(/outside|traversal|invalid path/i);
  expect(existsSync(join(dirname(root), "escape.txt"))).toBe(false);
});
```

## Acceptance Criteria

- [ ] Entries with absolute paths or `..` segments are rejected before any write.
- [ ] A restored file can never be created outside `root`.
- [ ] A regression test covers the traversal case.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-001`
- Module: `src/backup/restore.ts`, `src/backup/archive.ts`
