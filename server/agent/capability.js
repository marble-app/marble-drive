// What a provider is allowed to be, this run.
//
// A provider declares what it can do; the host decides what it may do. The two
// are separate because a drive owner needs one switch that holds everything
// down without editing any adapter, and because a provider that has not been
// taught the vocabulary yet should still get the drive — that is what "a new
// CLI I add later" means.

export const CAPABILITIES = ['documents', 'full'];

/** A provider's capability, after the host's switch has had its say. Anything
 *  unrecognised is `full`: a new adapter is a CLI with its own tools, and those
 *  tools should see the drive unless it opted into `documents`. */
export function effectiveCapability(provider, { power } = {}) {
  const declared = CAPABILITIES.includes(provider?.capability) ? provider.capability : 'full';
  return power === 'documents' ? 'documents' : declared;
}
