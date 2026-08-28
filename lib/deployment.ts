export type DeploymentMode = 'hosted' | 'self-hosted';

// next.config.mjs resolves the mode once at build time. Keeping the public
// value behind this module gives client and server code one shared question to
// ask instead of scattering Vercel/environment checks through the app.
export const DEPLOYMENT_MODE: DeploymentMode =
  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'self-hosted';

export const IS_HOSTED_DEPLOYMENT = DEPLOYMENT_MODE === 'hosted';

export const RELEASE_NOTES_URL =
  'https://github.com/appariciojunior/motion-studio-open/commits/main/';
