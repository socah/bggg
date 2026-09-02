#!/bin/sh
set -eu

SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/setup-herdr.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
STUBS=$WORK/bin
mkdir -p "$STUBS"

cat >"$STUBS/curl" <<'STUB'
#!/bin/sh
set -eu
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    output=$2
    shift 2
  else
    shift
  fi
done
mkdir -p "$(dirname "$output")"
printf '%s\n' '#!/bin/sh' 'mkdir -p "$HOME/.local/bin"' 'touch "$HOME/.local/bin/herdr"' 'chmod +x "$HOME/.local/bin/herdr"' >"$output"
STUB

cat >"$STUBS/npx" <<'STUB'
#!/bin/sh
printf '%s\n' "npx $*" >>"$CALL_LOG"
STUB

chmod +x "$STUBS/curl" "$STUBS/npx"
mkdir -p "$WORK/home"

HOME="$WORK/home" PATH="$STUBS:$PATH" CALL_LOG="$WORK/calls" \
  sh "$SCRIPT"

test -x "$WORK/home/.local/bin/herdr"
grep -Fq 'npx --yes skills add herdrdev/herdr --skill herdr -g' "$WORK/calls"
printf '%s\n' 'all tests passed'
