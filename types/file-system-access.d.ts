export {};

// @types/wicg-file-system-access declares `interface DirectoryPickerOptions {}`
// — empty. TypeScript's excess-property check has nothing to check against, so
// every option passed to showDirectoryPicker is accepted, including a typo. The
// browser then silently ignores the unknown key and the call still resolves, so
// the mistake reaches production looking like it worked.
//
// That is not hypothetical here: the export dialog already passed `mode` and
// `id` unvalidated, and the fix for the blocked-folder bug turns on the exact
// spelling of `startIn`. Declaration merging fills the interface in, so a
// mistyped option is a build error instead of a shrug.
//
// Values follow the spec's well-known directories:
// https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
declare global {
  type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';

  interface DirectoryPickerOptions {
    /** Lets the browser remember a directory per picker. */
    id?: string;
    /** Defaults to 'read'; writing into the folder needs 'readwrite'. */
    mode?: FileSystemPermissionMode;
    /**
     * Where the dialog opens. A directory remembered under `id` takes
     * precedence, so this steers the first pick — which is the one that lands
     * on a blocked location when it is left out.
     */
    startIn?: WellKnownDirectory | FileSystemHandle;
  }
}
