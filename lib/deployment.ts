export type DeploymentMode = 'hosted' | 'self-hosted';

// next.config.mjs resolves the mode once at build time. Keeping the public
// value behind this module gives client and server code one shared question to
// ask instead of scattering Vercel/environment checks through the app.
export const DEPLOYMENT_MODE: DeploymentMode =
  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'self-hosted';

export const IS_HOSTED_DEPLOYMENT = DEPLOYMENT_MODE === 'hosted';

export const RELEASE_NOTES_URL =
  'https://github.com/appariciojunior/motion-studio-open/commits/main/';

// Two sections live in the repository without being finished: the 3D stage and
// the Web stage. A built app closes them, because an unfinished section is not
// a preview of anything a person can use — and Web in particular evaluates
// pasted source with the app's own privileges (see the SECURITY note in
// components/WebStage.tsx). Development leaves them open so the work can carry
// on; an explicit NEXT_PUBLIC_EXPERIMENTS wins over both defaults, so a build
// with them switched on needs an env value, not a code edit.
export const EXPERIMENTS_ENABLED =
  process.env.NEXT_PUBLIC_EXPERIMENTS === '1' ? true
    : process.env.NEXT_PUBLIC_EXPERIMENTS === '0' ? false
      : process.env.NODE_ENV !== 'production';
