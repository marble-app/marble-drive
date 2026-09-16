// The agent CLIs this host knows how to run. Plan 2 registers
// `claude-subscription`, `claude-api` and `cursor` here; until then the
// registry is empty and a host can only run providers handed to `createDrive`.

export const builtInProviders = () => new Map();
