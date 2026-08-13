import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Library',
  description: 'Browse and tweak the motion templates, then save your own.',
};

// Renders nothing on purpose — EditorShell (the group layout) reads the URL and
// shows the matching panels. The file exists so the section has a real route,
// a shareable link and its own <title>.
export default function LibraryPage() {
  return null;
}
