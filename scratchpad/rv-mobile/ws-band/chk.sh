#!/bin/zsh
run() {
  echo "=== $1 x $2 ==="
  node look.mjs 8742 chk-$1 $1 $2 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(' bandHeight',d['bandHeight'],'pageOverflow',d['pageOverflowPx'],'errors',d['pageErrors'])
print(' band overlaps:',[o for o in d['overlaps'] if 'now-ref' in o['chip']])
print(' band tooSmall:',[t for t in d['tooSmallTargets'] if 'now-ref' in t['el']])
print(' ALL overlaps count:',len(d['overlaps']))
"
}
run 1440 900
run 744 1000
run 430 932
run 390 844
