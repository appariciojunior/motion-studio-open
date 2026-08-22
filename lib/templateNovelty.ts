export const TEMPLATE_SEEN_KEY = 'motion-seen-templates-v1';

export function readSeenTemplateIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_SEEN_KEY) || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function markTemplateIdsSeen(ids: Iterable<string>): Set<string> {
  const next = readSeenTemplateIds();
  for (const id of ids) next.add(id);
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(TEMPLATE_SEEN_KEY, JSON.stringify([...next])); } catch { /* non-fatal */ }
  }
  return next;
}
