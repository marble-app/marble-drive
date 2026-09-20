#!/bin/zsh
for v in spine board timeline now map claims questions framings; do
  node look.mjs 8742 v-$v 390 844 $v 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('$v'.ljust(10), 'arrange',d['view'],'band',d['bandHeight'],'pageOverflow',d['pageOverflowPx'],
      'overlaps',[o for o in d['overlaps'] if 'now-ref' in o['chip']],
      'small',[t for t in d['tooSmallTargets'] if 'now-ref' in t['el']], 'err',d['pageErrors'][:1])
"
done
