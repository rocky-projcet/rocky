# Rocky macOS manual install/update

Release tag: `v0.1.1`

Rocky does not yet have a finalized signed macOS installer/app bundle. Until
that flow lands, use the manual update helper when replacing an existing Rocky
payload with a new release checkout or extracted payload.

## Manual update-safe path

From the new Rocky payload directory:

```sh
scripts/update-macos-manual.sh /path/to/existing/Rocky
```

The helper requires the target to contain `.rocky-install`, treats it as an
existing Rocky install, and then:

1. Moves the previous install aside as a timestamped backup.
2. Copies the new app/runtime payload into the target path.
3. Restores local state/settings paths: `.runtime`, `.codex`, `.rocky-env.ps1`,
   `.env`, `.env.local`, and the `.tools` runtime tool cache.
4. Writes `.rocky-install` with the release tag.
5. Removes the backup only after the update completes.

If copying or migration fails, the helper restores the previous install from the
backup and writes recovery information under `.rocky-update-logs`.

## State preservation

The recommended Rocky state root remains outside the app payload when possible
(for example a user-profile/Application Support location once the app bundle
flow is finalized). If you used an in-app `.runtime/state` during early manual
installs, the update helper preserves it.

## Known limitations

- No automatic download/update channel is provided in `v0.1.1`.
- No silent/background update flow is provided.
- Rollback is best-effort command-line recovery, not a complete GUI rollback UX.
- The macOS app bundle/signing/notarization behavior should be aligned with the
  dedicated macOS packaging work before customer distribution.
