// server/hub/home-paths.js
// Where a drive lives on one of the owner's own machines, by name: the Mac
// (macOS, launchd) or the PC (Linux under WSL2, systemd). The real drive
// (bryan) is "~/Marble Drive" on 4401; a trial drive (t-bryan) sits beside it
// on 4402. macos/launchd/home.sh and linux/systemd/home.sh follow the same
// names.

import os from 'node:os';
import path from 'node:path';

export function homePaths(name, { home = os.homedir(), platform = process.platform } = {}) {
  const mac = platform === 'darwin';
  return {
    root: path.join(home, name === 'bryan' ? 'Marble Drive' : `Marble Drive (${name})`),
    hubEnv: path.join(home, '.config', 'marble-drive', `hub-${name}.env`),
    port: name === 'bryan' ? 4401 : 4402,
    label: mac ? `com.marble.drive.home.${name}` : `marble-drive-home-${name}`,
    app: mac
      ? path.join(home, 'Library', 'Application Support', 'Marble Drive', 'app')
      : path.join(home, '.local', 'share', 'marble-drive', 'app'),
  };
}
