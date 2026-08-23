import EditorShell from '@/components/EditorShell';

// Every section route — /, /library, /mockup, /projects, /3d, /web, /board —
// lives in this group, so they all share one EditorShell instance. That is the
// whole point of the group: Next keeps a layout mounted across sibling routes,
// so switching sections swaps panels instead of tearing down the WebGL context
// and rebuilding the stage.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <EditorShell>{children}</EditorShell>;
}
