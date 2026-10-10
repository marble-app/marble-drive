#!/usr/bin/env bash
# A Marble Drive of their own for one tester, on a Fly Sprite
# (docs/superpowers/specs/2026-09-23-a-sprite-per-tester-design.md).
#
#   tools/sprite-provision.sh <person> [--agent api|subscription] [--key-file <path>] [--org <org>] [--local]
#   tools/sprite-provision.sh --resume <person> [--org <org>] [--local]   finish one that stopped part way
#   tools/sprite-provision.sh --remove <person> [--org <org>]
#   tools/sprite-provision.sh --door <name> --account <id> --keys <file> [--org <org>] [--local]
#                                  a drive the door asked for (the door sprite runs this)
#   tools/sprite-provision.sh --resume <name> --door <name> --account <id> --keys <file>
#   tools/sprite-provision.sh --remove <name> --door <name>
#
# Makes sprite t-<person>, gives it a passphrase and its own settings, deploys
# the pushed main to it, opens its URL behind the passphrase, and prints a note
# to send them. Agents: `api` (default) uses an Anthropic Console key — preload
# one with --key-file, or the tester adds theirs in Agents settings;
# `subscription` uses the Claude login you give it in its console. Nothing of
# yours is copied to the sprite except, with --key-file, that one key.
#
# --door: the drive someone asked for at marbledrive.app (docs/superpowers/
# specs/2026-10-10-accounts-and-sign-in-design.md). Sprite d-<name>, label
# marble-user, a random passphrase nobody is shown (the drive's key for scripts
# and its agent's browser), and the door's settings: its public keys from
# --keys, the drive's name, and its owner's account. It prints `step: <step>
# <state>` lines and `url: <sprite URL>` for the door sprite to report, and no
# note, no passphrase, and no roster entry.
#
# The roster (person, sprite, URL, passphrase, agent) is kept on this Mac in
# ~/.config/marble-drive/testers.json — never an API key. --local deploys this
# Mac's working copies instead of the pushed main (for trying unreleased code).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ORG=marble-drive AGENT=api KEY_FILE="" REMOVE=0 RESUME=0 PERSON="" DEPLOY_FLAGS=()
DOOR="" ACCOUNT="" KEYS_FILE=""
# What deploys a release to the sprite; a test points this at a stub.
DEPLOY="${MARBLE_SPRITE_DEPLOY:-$HERE/sprite-deploy.sh}"
ROSTER_DIR="$HOME/.config/marble-drive"
ROSTER="$ROSTER_DIR/testers.json"
REMOTE_CONFIG=/home/sprite/.config/marble-drive

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
say() { printf '==> %s\n' "$*"; }
die() { printf 'sprite-provision: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=${2:?}; shift 2 ;;
    --agent) AGENT=${2:?}; shift 2 ;;
    --key-file) KEY_FILE=${2:?}; shift 2 ;;
    --remove) REMOVE=1; PERSON=${2:?}; shift 2 ;;
    --resume) RESUME=1; PERSON=${2:?}; shift 2 ;;
    --local) DEPLOY_FLAGS+=(--local); shift ;;
    --door) DOOR=${2:?}; shift 2 ;;
    --account) ACCOUNT=${2:?}; shift 2 ;;
    --keys) KEYS_FILE=${2:?}; shift 2 ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [[ -z "$PERSON" ]] || usage; PERSON=$1; shift ;;
  esac
done
[[ -n "$DOOR" && -z "$PERSON" ]] && PERSON=$DOOR
[[ -n "$PERSON" ]] || usage
[[ "$AGENT" == api || "$AGENT" == subscription ]] || die "--agent is api or subscription"
[[ -z "$KEY_FILE" || "$AGENT" == api ]] || die "--key-file is for --agent api"
[[ -z "$KEY_FILE" || -r "$KEY_FILE" ]] || die "cannot read $KEY_FILE"

SLUG="$(printf '%s' "$PERSON" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//; s/-*$//')"
[[ -n "$SLUG" ]] || die "\"$PERSON\" has nothing a sprite name can use"
SPRITE="t-$SLUG"
LABEL=marble-tester
step() { [[ -z "$DOOR" ]] || printf 'step: %s %s\n' "$1" "$2"; }

if [[ -n "$DOOR" ]]; then
  # The same rule as the door's (worker/src/door/names.js).
  [[ "$DOOR" =~ ^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$ && "$DOOR" != *--* && ! "$DOOR" =~ ^(mac|pc|t|d)- ]] \
    || die "\"$DOOR\" is not a drive name (3 to 30 of a-z, 0-9 and -)"
  [[ "$PERSON" == "$DOOR" ]] || die "--door names the drive; give the same name to --resume or --remove"
  SPRITE="d-$DOOR"
  LABEL=marble-user
  [[ "$AGENT" == api && -z "$KEY_FILE" ]] || die "--door drives use their person's own key; --agent and --key-file are not for them"
  if [[ $REMOVE == 0 ]]; then
    [[ "$ACCOUNT" =~ ^[0-9a-f]{16}$ ]] || die "--account is the owner's account id (16 hex digits)"
    [[ -r "$KEYS_FILE" ]] || die "--keys names a readable file of the door's public keys"
    DOOR_KEYS="$(tr -s ' \t\n' ' ' <"$KEYS_FILE" | sed 's/^ *//; s/ *$//')"
    [[ "$DOOR_KEYS" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9+/=]+( [A-Za-z0-9_-]+:[A-Za-z0-9+/=]+)*$ ]] \
      || die "the keys file is <key id>:<base64 public key> entries separated by spaces"
  fi
fi

exists() { sprite list -o "$ORG" --prefix "$SPRITE" 2>/dev/null | grep -qx "$SPRITE"; }
on() { sprite exec -o "$ORG" -s "$SPRITE" --no-stdin "$@"; }

roster() { # roster set <json-object> | roster drop
  mkdir -p "$ROSTER_DIR" && chmod 700 "$ROSTER_DIR"
  node - "$ROSTER" "$SPRITE" "$1" "${2:-}" <<'JS'
const fs = require('fs');
const [file, sprite, action, value] = process.argv.slice(2);
let all = {};
try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
if (action === 'set') all[sprite] = JSON.parse(value);
else delete all[sprite];
fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
fs.chmodSync(file, 0o600);
JS
}

# --------------------------------------------------------------- removing

if [[ $REMOVE == 1 ]]; then
  exists || die "no sprite $SPRITE in $ORG"
  echo "This destroys $SPRITE and everything in it: the tester's whole drive, every checkpoint."
  read -r -p "Type $SPRITE to confirm: " typed
  [[ "$typed" == "$SPRITE" ]] || die "not confirmed; nothing was destroyed"
  sprite destroy -o "$ORG" --force "$SPRITE"
  [[ -n "$DOOR" ]] || roster drop
  say "destroyed $SPRITE"
  exit 0
fi

# ------------------------------------------------------------- making one

if [[ $RESUME == 1 ]]; then
  exists || die "no sprite $SPRITE in $ORG to resume"
else
  exists && die "$SPRITE already exists in $ORG (finish it with --resume, remove it, or pick another name)"
fi

WORK="$(mktemp -d)"
chmod 700 "$WORK"
CREATED=0
finish() {
  rm -rf "$WORK"
  if [[ $CREATED == 1 && ${DONE:-0} != 1 ]]; then
    echo >&2
    echo "sprite-provision: $SPRITE was created but not finished. Fix the problem and finish it, or remove it:" >&2
    if [[ -n "$DOOR" ]]; then
      echo "  tools/sprite-provision.sh --resume $DOOR --door $DOOR --account $ACCOUNT --keys <file> --org $ORG" >&2
      echo "  tools/sprite-provision.sh --remove $DOOR --door $DOOR --org $ORG" >&2
    else
      echo "  tools/sprite-provision.sh --remove $SLUG --org $ORG" >&2
    fi
  fi
}
trap finish EXIT

if [[ $RESUME == 1 ]]; then
  # Everything up to its settings happened; take what it already has.
  CREATED=1
  SETTINGS="$(on -- cat "$REMOTE_CONFIG/sprite.env" 2>/dev/null)" || die "$SPRITE has no settings to resume from; remove it and provision again"
  PASSPHRASE="$(sed -n 's/^MARBLE_DRIVE_SECRET=//p' <<<"$SETTINGS")"
  [[ "$(sed -n 's/^MARBLE_DRIVE_AGENT_PROVIDER=//p' <<<"$SETTINGS")" == claude-subscription ]] && AGENT=subscription
  [[ -n "$PASSPHRASE" ]] || die "$SPRITE's settings have no passphrase"
  say "resuming $SPRITE"
  step machine done
else
step machine now
say "creating $SPRITE in $ORG"
sprite create -o "$ORG" --skip-console --label "$LABEL" "$SPRITE"
CREATED=1

PASSPHRASE="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24)"
[[ ${#PASSPHRASE} -eq 24 ]] || die "could not make a passphrase"
PROVIDER=claude-api
[[ "$AGENT" == subscription ]] && PROVIDER=claude-subscription

say "giving $SPRITE its own settings"
umask 077
{
  echo "# $SPRITE — made by tools/sprite-provision.sh on $(date -u +%Y-%m-%d)"
  echo "MARBLE_DRIVE_SECRET=$PASSPHRASE"
  echo "MARBLE_DRIVE_SECURE_COOKIE=1"
  echo "MARBLE_DRIVE_AGENT_PROVIDER=$PROVIDER"
  if [[ -n "$DOOR" ]]; then
    # The door: its public keys, the name a pass must be for, and the account
    # it must name. `tools` keeps the passphrase off the browser: nobody was
    # given it, and a person comes in by signing in.
    echo "MARBLE_DOOR_KEYS=$DOOR_KEYS"
    echo "MARBLE_DOOR_NAME=$DOOR"
    echo "MARBLE_DOOR_OWNER=$ACCOUNT"
    echo "MARBLE_DRIVE_GATE=tools"
    echo "MARBLE_DRIVE_PUBLIC_URL=https://$DOOR.marbledrive.app"
  fi
} >"$WORK/sprite.env"
on -- sh -c "mkdir -p $REMOTE_CONFIG && chmod 700 $REMOTE_CONFIG"
on --file "$WORK/sprite.env:$REMOTE_CONFIG/sprite.env" -- chmod 600 "$REMOTE_CONFIG/sprite.env"

if [[ -n "$KEY_FILE" ]]; then
  say "placing the API key (not printed, not kept here)"
  node -e '
    const fs = require("fs");
    const key = fs.readFileSync(process.argv[1], "utf8").trim();
    if (!/^sk-ant-/.test(key)) { console.error("that does not look like an Anthropic API key"); process.exit(1); }
    fs.writeFileSync(process.argv[2], JSON.stringify({ anthropic: key }, null, 2) + "\n", { mode: 0o600 });
  ' "$KEY_FILE" "$WORK/agent-keys"
  on --file "$WORK/agent-keys:$REMOTE_CONFIG/agent-keys" -- chmod 600 "$REMOTE_CONFIG/agent-keys"
  rm -f "$WORK/agent-keys"
fi
step machine done
fi

step install now
say "deploying Marble Drive to $SPRITE"
"$DEPLOY" "$SPRITE" --org "$ORG" ${DEPLOY_FLAGS[@]+"${DEPLOY_FLAGS[@]}"}
step install done

say "opening $SPRITE's URL behind its passphrase"
sprite config update -o "$ORG" --url-auth public "$SPRITE" >/dev/null
URL="$(sprite info -o "$ORG" -s "$SPRITE" 2>/dev/null | awk '/^URL:/ {print $2}')"
[[ -n "$URL" ]] || die "could not read $SPRITE's URL"

step check now
say "checking it from outside"
ok=0
for _ in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/health")" == 200 ]] && { ok=1; break; }
  sleep 2
done
[[ $ok == 1 ]] || die "$URL/health did not answer"
# Asked as a browser: the gate sends a browser to its passphrase page and
# answers anything else with a 401.
where="$(curl -s -o /dev/null -H 'Accept: text/html' -w '%{http_code} %{redirect_url}' "$URL/")"
if [[ -n "$DOOR" ]]; then
  # A door drive sends a browser to sign in (or, asked from its own machine,
  # to its passphrase page). Either way it is closed.
  [[ "$where" == 302*"marbledrive.app/enter"* || "$where" == 302*"/gate"* ]] || die "$URL/ did not send a browser to sign in (got: $where)"
  step check done
  DONE=1
  say "made $SPRITE for $DOOR.marbledrive.app"
  echo "url: $URL"
  exit 0
fi
[[ "$where" == 302*"/gate"* ]] || die "$URL/ did not ask for the passphrase (got: $where)"

roster set "$(node -e 'console.log(JSON.stringify({ person: process.argv[1], sprite: process.argv[2], org: process.argv[3], url: process.argv[4], passphrase: process.argv[5], agent: process.argv[6], created: new Date().toISOString() }))' "$PERSON" "$SPRITE" "$ORG" "$URL" "$PASSPHRASE" "$AGENT")"
DONE=1

echo
if [[ "$AGENT" == subscription ]]; then
  echo "One step left for you: sign $SPRITE's agents in with your Claude login."
  echo "  sprite console -o $ORG -s $SPRITE     then run: claude login"
  echo
fi
echo "---------------------------------------------------------------- send this"
echo "Hi $PERSON — here is your own Marble Drive:"
echo
echo "  $URL"
echo "  passphrase: $PASSPHRASE"
echo
if [[ "$AGENT" == subscription ]]; then
  echo "Agents are ready to use."
elif [[ -n "$KEY_FILE" ]]; then
  echo "Agents are set up with an API key for you."
else
  echo "To use agents: open Agents, then Settings; Claude is set to \"API key\" — paste your Anthropic API key there."
fi
echo "It is yours: nothing you make there is shared with anyone."
echo "---------------------------------------------------------------------------"
