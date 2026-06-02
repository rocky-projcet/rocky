#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${1:-}"
RELEASE_TAG="v0.1.3"

if [[ -z "$TARGET_ROOT" ]]; then
  cat >&2 <<'USAGE'
Usage: scripts/update-macos-manual.sh /path/to/existing/Rocky

Copies the current Rocky payload over an existing manual macOS install while
preserving local state/settings directories. This is a manual helper until the
macOS app bundle/installer flow is finalized.
USAGE
  exit 64
fi

TARGET_ROOT="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$TARGET_ROOT")"
LOG_ROOT="$TARGET_ROOT/.rocky-update-logs"
LOG_PATH="$LOG_ROOT/macos-update-$(date -u +%Y%m%d-%H%M%S).log"
BACKUP_ROOT="$(dirname "$TARGET_ROOT")/.rocky-update-backup-$(basename "$TARGET_ROOT")-$(date -u +%Y%m%d-%H%M%S)"

log() {
  mkdir -p "$LOG_ROOT"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_PATH"
}

if [[ ! -e "$TARGET_ROOT/.rocky-install" ]]; then
  echo "Refusing to update: $TARGET_ROOT is missing .rocky-install" >&2
  exit 65
fi

cleanup_failed_update() {
  local status=$?
  if [[ $status -ne 0 && -d "$BACKUP_ROOT" ]]; then
    rm -rf "$TARGET_ROOT"
    mv "$BACKUP_ROOT" "$TARGET_ROOT"
    mkdir -p "$TARGET_ROOT/.rocky-update-logs"
    printf '[%s] Restored previous Rocky install after failed update.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$TARGET_ROOT/.rocky-update-logs/macos-update-recovery.log"
  fi
  exit $status
}
trap cleanup_failed_update EXIT

log "Updating Rocky payload at $TARGET_ROOT to $RELEASE_TAG"
log "Previous install backup: $BACKUP_ROOT"
mv "$TARGET_ROOT" "$BACKUP_ROOT"
mkdir -p "$TARGET_ROOT"

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.tmp/' \
  --exclude 'releases/' \
  --exclude '.tools/' \
  --exclude '.runtime/' \
  --exclude '.codex/' \
  --exclude '.env' \
  --exclude '.env.local' \
  "$SOURCE_ROOT/" "$TARGET_ROOT/"

for preserved in .runtime .codex .tools .rocky-env.ps1 .env .env.local; do
  if [[ -e "$BACKUP_ROOT/$preserved" ]]; then
    rm -rf "$TARGET_ROOT/$preserved"
    mv "$BACKUP_ROOT/$preserved" "$TARGET_ROOT/$preserved"
    log "Preserved existing install data: $preserved"
  fi
done

printf '%s\n' "$RELEASE_TAG" > "$TARGET_ROOT/.rocky-install"
rm -rf "$BACKUP_ROOT"
trap - EXIT
log "Rocky macOS manual update completed. Existing state and local settings were preserved."
