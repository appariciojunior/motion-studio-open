// `/` is an alias for the library, not a redirect: a server redirect can't run
// in the static export used for GitHub Pages. /library is the canonical URL and
// the rail links there; landing on `/` opens the same section.
export default function IndexPage() {
  return null;
}
