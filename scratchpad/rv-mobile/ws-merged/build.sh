#!/bin/sh
# Compose the named parts, in the given order, into one pair of files.
# usage: ./build.sh shell band columns cards
cd "$(dirname "$0")"
: > part.css; : > part.js
for a in "$@"; do
  d=../ws-$a
  if [ -s "$d/part.css" ]; then printf '\n/* ===== %s ===== */\n' "$a" >> part.css; cat "$d/part.css" >> part.css; fi
  if [ -s "$d/part.js" ];  then printf '\n/* ===== %s ===== */\n' "$a" >> part.js;  cat "$d/part.js"  >> part.js;  fi
done
wc -l part.css part.js
