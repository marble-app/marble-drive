#!/usr/bin/env bash
# The one-time trial of the PC drives' backups (docs/HOSTING.md, "Backups of
# PC drives"): a real backup to R2 through the real unit, restored, and
# compared file by file. Run by the owner after setup, and once before the
# study:
#
#   sudo /usr/local/lib/marble-guests/backup-check.sh [<drive>]
#
# Without a name it makes a scratch drive, backup-check--<hex>: documents, odd
# names, a 3 MB file, a folder only the drive's own user may read, what a
# backup leaves out, links and a pipe a backup must pass over, and a login in
# its home. It backs that up through marble-guest-backup@, runs it again
# unchanged, changes, deletes and adds a file and backs up again, restores
# both backups with restore-guest --as into scratch names, and compares every
# file by checksum. Then it deletes the scratch folders, their status and the
# scratch backups in R2.
#
# With a drive's name (your test drive) it backs that drive up, restores the
# backup --as a scratch name and compares; only the scratch copy is deleted.
# Files the drive changed after its backup are counted, not compared.
#
# One line per check, PASS <check> or FAIL <check>: <why>, as escape-check.sh
# prints them. Exits 1 if any failed.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-lib.sh
. "$HERE/backup-lib.sh"
real=${1:-}
if [[ $# -gt 1 || $real == -* ]] || { [[ -n $real ]] && [[ ! $real =~ $NAME_RE ]]; }; then
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 2
fi
need_root

failures=0
pass() { printf 'PASS %s\n' "$*"; }
fail() {
  printf 'FAIL %s: %s\n' "$1" "$2"
  failures=$((failures + 1))
}
fatal() {
  fail "$1" "$2"
  exit 1
}

[[ -x $RCLONE && -x $HERE/restore-guest ]] || fatal installed "run the installed copy: sudo $TOOLS/backup-check.sh"
load_settings || fatal installed "$SETTINGS_WHY"
if [[ -z ${MARBLE_GUESTS_DIR:-} ]]; then
  for unit in marble-guest-backup@.service marble-guests-backup.service marble-guests-backup.timer marble-guest-remove@.service; do
    [[ -f /etc/systemd/system/$unit ]] || fatal installed "/etc/systemd/system/$unit is missing; run install.sh"
  done
  "$SYSTEMCTL" is-enabled --quiet marble-guests-backup.timer || fail installed "marble-guests-backup.timer is not enabled"
fi
pass "installed: units, tools and settings"

hex="$(od -An -tx1 -N3 /dev/urandom | tr -d ' \n')"
scratch="backup-check--$hex"
copy="$scratch-copy" old="$scratch-old"
names=("$copy")
[[ -n $real ]] || names+=("$scratch" "$old")
WORK="$(mktemp -d)"
cleanup() {
  local name left=0
  for name in "${names[@]}"; do
    rm -rf -- "${GUESTS:?}/$name" "$BACKUP_STATE/restoring/$name".*
    rm -f -- "$BACKUP_STATE/status/$name.json" "$BACKUP_STATE/manifests/$name.json" "$BACKUP_STATE/locks/$name.lock"
    # The hourly sweep may have backed a scratch folder up meanwhile.
    if remote_for "$name" && [[ -n "$(rc lsf -R --max-depth 1 "$RAW_PREFIX" 2>/dev/null || true)" ]]; then
      rc purge "$RAW_PREFIX" 2>/dev/null || left=1
    fi
  done
  rm -rf "$WORK"
  if ((left)); then fail cleanup "a scratch backup is still in R2 under guests/$scratch*"; else pass "cleanup: scratch folders, their status and their backups in R2 are gone"; fi
  if ((failures)); then exit 1; fi
}

for name in "${names[@]}"; do
  if [[ -e $GUESTS/$name || -e $GUEST_ETC/$name.env || -e $BACKUP_STATE/status/$name.json ]]; then
    fatal names "$name is in use on this PC"
  fi
  remote_for "$name" || fatal names "rclone could not be run"
  if [[ -n "$(rc lsf -R --max-depth 1 "$RAW_PREFIX" 2>/dev/null || true)" ]]; then fatal names "R2 already holds guests/$name/"; fi
done
trap cleanup EXIT

# The status of the last backup of a drive, as one key=value line.
status_of() {
  local file="$BACKUP_STATE/status/$1.json"
  "$PYTHON" -I -c 'import json,sys; s=json.load(open(sys.argv[1])); print(" ".join(f"{k}={str(v).lower() if isinstance(v,bool) else v}" for k,v in s.items() if k != "why"))' "$file" 2>/dev/null
}
back_up() {
  "$SYSTEMCTL" start "marble-guest-backup@$1.service" >"$WORK/unit.out" 2>&1 ||
    fatal "$2" "marble-guest-backup@$1 failed: $(tail -1 "$WORK/unit.out"); journalctl -u marble-guest-backup@$1 -n 30"
}
# Sets files to the count the status gives.
expect_status() {
  local line
  line="$(status_of "$1")"
  [[ $(field ok "$line") == true ]] || fatal "$2" "the status says the backup did not end well ($BACKUP_STATE/status/$1.json)"
  [[ $(field changed "$line") == "$3" ]] || fatal "$2" "the status says changed=$(field changed "$line"), not $3"
  files="$(field files "$line")"
}

if [[ -n $real ]]; then
  [[ -d $GUESTS/$real/drive ]] || fatal backup "$real has no drive folder on this PC"
  back_up "$real" backup
  line="$(status_of "$real")"
  [[ $(field ok "$line") == true ]] || fatal backup "the status of $real says the backup did not end well"
  pass "backup: marble-guest-backup@$real sent $real's drive ($(field files "$line") files, changed=$(field changed "$line"))"
  "$HERE/restore-guest" "$real" --as "$copy" >"$WORK/restore.out" 2>&1 || fatal restore "$(tail -1 "$WORK/restore.out")"
  if result="$(tree compare "$GUESTS/$real/drive" "$GUESTS/$copy/drive" "$BACKUP_STATE/manifests/$real.json")"; then
    pass "restore: every file came back the same, by checksum ($(field same "$result") files; $(field changed "$result") changed in $real since the backup, not compared)"
  else
    fail restore "the copy differs from the drive ($result)"
  fi
  exit 0
fi

# A scratch drive, as a drive's own user would leave it.
src="$GUESTS/$scratch/drive"
mkdir -p "$src/Notes" "$src/System" "$src/Private" "$src/.marble/history/start-here" "$src/.marble/blobs" \
  "$src/.marble/agents/c1" "$src/.marble/usage" "$src/.marble/console/backups" "$src/.marble/thumbs/.work-1" \
  "$GUESTS/$scratch/home/.claude"
printf '<!doctype html><title>Start here</title><h1>Start here</h1>\n' >"$src/start-here.mrbl"
printf '<h1>Ideas</h1>\n' >"$src/Notes/Ideas #1.mrbl"
printf '<h1>Café ☕</h1>\n' >"$src/Notes/Café ☕.mrbl"
printf "<h1>Design Don'ts</h1>\n" >"$src/System/Design Don'ts.mrbl"
: >"$src/Notes/Empty.mrbl"
head -c 3000000 /dev/urandom >"$src/.marble/blobs/big"
head -c 4000 /dev/urandom >"$src/.marble/history/start-here/1.mrbl.gz"
printf '{"kind":"turn"}\n' >"$src/.marble/agents/c1/events.jsonl"
printf '<h1>Only its own user may read this</h1>\n' >"$src/Private/Diary.mrbl"
chmod 700 "$src/Private"
chmod 600 "$src/Private/Diary.mrbl"
if ((EUID == 0)); then chown -R 61234:61234 "$src/Private"; fi
printf '{}\n' >"$src/.marble/usage/2026-10-25.jsonl"
printf '4242\n' >"$src/.marble/agents/host.lock"
printf '{}\n' >"$src/.marble/console/backups/report.json"
printf 'png\n' >"$src/.marble/thumbs/.work-1/t.png"
ln -s "$(settings_file)" "$src/link-to-the-key"
ln -s /etc "$src/link-to-etc"
mkfifo "$src/pipe"
printf 'not a real login\n' >"$GUESTS/$scratch/home/.claude/.credentials.json"
kept=9

back_up "$scratch" backup
expect_status "$scratch" backup true
[[ $files == "$kept" ]] || fail backup "the status counts $files files, not $kept"
pass "backup: marble-guest-backup@$scratch sent the scratch drive ($files files)"
cp "$BACKUP_STATE/manifests/$scratch.json" "$WORK/first.json"
cp -a "$src" "$WORK/first"
first="$(utc_of "$(field at "$(tree counts "$WORK/first.json")")")"

status_file="$BACKUP_STATE/status/$scratch.json"
if ((EUID == 0)); then
  runuser -u nobody -- cat "$status_file" >/dev/null 2>&1 || fail status "nobody cannot read $status_file"
else
  [[ $(stat -c %a "$status_file") == 644 ]] || fail status "$status_file is not 644"
fi
for secret in "$CFG_GUEST_BACKUP_PASSPHRASE" "$CFG_GUEST_BACKUP_SALT" "${CFG_R2_SECRET_ACCESS_KEY:-}" "${CFG_R2_ACCESS_KEY_ID:-}"; do
  if [[ -n $secret ]] && grep -qF -- "$secret" "$status_file"; then fail status "$status_file holds a secret"; fi
done
if grep -qE 'Ideas|Diary|start-here' "$status_file"; then fail status "$status_file names a file in the drive"; fi
pass "status: anyone on the PC can read it, and it holds counts, never a key or a name"

listed="$("$PYTHON" -I -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["files"]))' "$WORK/first.json")"
if grep -qE '^\.marble/(usage/|agents/host\.lock|console/backups/|thumbs/\.work-)' <<<"$listed"; then
  fail "left out" "the backup holds what it should leave out"
else
  pass "left out: the host lock, the usage ledger, Console's reports and thumbnail scratch"
fi
if grep -qE '^(link-to|pipe)' <<<"$listed"; then fail links "the backup holds a link or the pipe"; else pass "links and pipes: passed over, never followed"; fi
if grep -q 'credentials' <<<"$listed"; then fail home "the backup holds the login"; else pass "home: the drive's home and its login are not in the backup"; fi

back_up "$scratch" unchanged
expect_status "$scratch" unchanged false
pass "unchanged: a second run sent nothing"

remote_for "$scratch" || fatal encrypted "rclone could not be run"
rc lsf -R --files-only "$RAW_PREFIX" >"$WORK/raw" 2>"$WORK/raw.err" || fatal encrypted "R2 could not be listed: $(tail -1 "$WORK/raw.err")"
objects="$(grep -c . "$WORK/raw" || true)"
if ((objects == 0)); then
  fail encrypted "R2 holds nothing under guests/$scratch/"
elif grep -qiE 'start-here|ideas|café|diary|design|\.marble|manifest|\.mrbl' "$WORK/raw"; then
  fail encrypted "a name from the drive shows in R2 under guests/$scratch/"
else
  pass "encrypted: R2 holds $objects objects under guests/$scratch/, and none of the drive's names"
fi

sleep 1
printf '<h1>Start here, changed</h1>\n' >"$src/start-here.mrbl"
rm "$src/Notes/Ideas #1.mrbl"
printf '<h1>New</h1>\n' >"$src/Notes/New.mrbl"
back_up "$scratch" changes
expect_status "$scratch" changes true
[[ $files == "$kept" ]] || fail changes "the status counts $files files, not $kept"
pass "changes: a changed file, a deleted one and a new one were sent"

"$PYTHON" -I "$TREE" scan "$src" "$WORK/before.json" >/dev/null
"$HERE/restore-guest" "$scratch" --as "$copy" >"$WORK/restore.out" 2>&1 || fatal restore "$(tail -1 "$WORK/restore.out")"
if result="$(tree compare "$src" "$GUESTS/$copy/drive" "$BACKUP_STATE/manifests/$scratch.json")"; then
  pass "restore: every file came back the same, by checksum ($(field same "$result") files)"
else
  fail restore "the copy differs from the drive ($result)"
fi
"$PYTHON" -I "$TREE" scan "$src" "$WORK/after.json" >/dev/null
if "$PYTHON" -I "$TREE" same "$WORK/after.json" "$WORK/before.json"; then
  pass "original: restoring --as left $scratch as it was"
else
  fail original "restoring --as changed $scratch"
fi
if [[ -e $GUESTS/$copy/home ]]; then fail home "the restore made a home"; fi

"$HERE/restore-guest" "$scratch" --from "$first" --as "$old" >"$WORK/restore.out" 2>&1 || fatal "restore --from" "$(tail -1 "$WORK/restore.out")"
if result="$(tree compare "$WORK/first" "$GUESTS/$old/drive" "$WORK/first.json")"; then
  pass "restore --from: the first backup came back as it was ($(field same "$result") files, by checksum)"
else
  fail "restore --from" "the copy differs from the first backup ($result)"
fi
if ((EUID == 0)); then
  [[ $(stat -c %u "$GUESTS/$old") == 0 ]] || fail ownership "the restored folder is not root's, so systemd would not hand it over on start"
  pass "ownership: the restored folder is root's until its drive starts, when systemd hands all of it over"
fi
