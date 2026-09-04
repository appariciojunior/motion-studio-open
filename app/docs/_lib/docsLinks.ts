/**
 * Outbound links shown in the docs header.
 *
 * The repository URL is not guessed — it is the one the app itself uses for the
 * local updater and the export dialog (`lib/localUpdate.ts`,
 * `components/ExportDialog.tsx`), so there is one truth for it.
 *
 * Social accounts: fill these in and they appear. Entries with an empty `url`
 * are skipped, so an unfilled slot renders nothing rather than a dead link —
 * this file is the only place to edit.
 */

export const REPO_URL = 'https://github.com/appariciojunior/motion-studio-open';

export type SocialNetwork = 'x' | 'instagram' | 'linkedin' | 'youtube' | 'discord' | 'site';

export interface SocialLink {
  network: SocialNetwork;
  label: string;
  url: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  // { network: 'x',         label: 'X',         url: 'https://x.com/…' },
  // { network: 'instagram', label: 'Instagram', url: 'https://instagram.com/…' },
  // { network: 'linkedin',  label: 'LinkedIn',  url: 'https://linkedin.com/company/…' },
];

/** Only the ones actually filled in. */
export const socials = (): SocialLink[] => SOCIAL_LINKS.filter((s) => s.url.trim() !== '');
