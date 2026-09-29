// server/hub/mac-paths.js
// Where a drive lives on the owner's Mac, by name. The real drive (bryan) is
// "~/Marble Drive" on 4401; a trial drive (t-bryan) sits beside it on 4402.
// macos/launchd/home.sh follows the same names.

import os from 'node:os';
import path from 'node:path';

export function macPaths(name, home = os.homedir()) {
  return {
    root: path.join(home, name === 'bryan' ? 'Marble Drive' : `Marble Drive (${name})`),
    hubEnv: path.join(home, '.config', 'marble-drive', `hub-${name}.env`),
    port: name === 'bryan' ? 4401 : 4402,
    label: `com.marble.drive.home.${name}`,
    app: path.join(home, 'Library', 'Application Support', 'Marble Drive', 'app'),
  };
}
