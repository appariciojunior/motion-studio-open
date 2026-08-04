'use client';

import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { use3DStore } from '@/store/use3DStore';
import { findDevice, selectDevice } from '@/three3d/devices';

const NAV = [
  { id: 'projects', label: 'Projects', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2.75 6.25A1.5 1.5 0 014.25 4.75h3l1.5 1.75h6a1.5 1.5 0 011.5 1.5v6.25a1.5 1.5 0 01-1.5 1.5h-10.5a1.5 1.5 0 01-1.5-1.5V6.25z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
  ) },
  { id: 'library', label: 'Library', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>
  ) },
  { id: '3d', label: '3D', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M3.7 6.4L10 10l6.3-3.6M10 10v7.4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
  ) },
  { id: 'mockup', label: 'Mockup', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="6" y="2.5" width="8" height="15" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
  ) },
  { id: 'web', label: 'Web', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 6.5L4 10l3.5 3.5M12.5 6.5L16 10l-3.5 3.5M11 4.5l-2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ) },
  // Board mode — a DOM playground of arranged cards with hover interactions,
  // and the entry point for the drop-in React component export. Its nav id is
  // 'board' rather than the original 'new': the + button at the top of the rail
  // now creates a project, so the two ids would collide. Kept last in the list.
  { id: 'board', label: 'Board', icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4.5" width="4.5" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><rect x="8" y="4.5" width="4" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5" opacity="0.65"/><rect x="13" y="4.5" width="4.5" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/></svg>
  ) },
];

export default function IconRail() {
  const active = useUIStore((s) => s.nav);
  const theme = useUIStore((s) => s.theme);
  const setActive = useUIStore((s) => s.setNav);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const createProject = useProjectStore((s) => s.create);
  const projectCount = useProjectStore((s) => s.projects.length);
  const effectId = use3DStore((s) => s.effectId);
  const setEffect = use3DStore((s) => s.setEffect);

  // An ACTION, not a nav section — so it never takes the active state. The +
  // icon at the top of the rail now creates what it looks like it creates.
  const newProject = () => {
    createProject(`Project ${projectCount + 1}`);
    setActive('projects');
  };

  // '3d' and 'mockup' share one ThreeStage3D + use3DStore.effectId (one 3D
  // canvas, one active effect at a time). 'mockup' always forces the 'mockup'
  // effect; leaving it back to '3d' hands the id back to a real pickable
  // effect so the two tabs never show the wrong stage.
  const goNav = (id: string) => {
    if (id === 'mockup') {
      setEffect('mockup');
      // First time in — land on a real device + a clean, dark stage rather
      // than an empty scene. Only when nothing's loaded yet: re-entering the
      // tab shouldn't clobber a device (or background) the user already set.
      const s3d = use3DStore.getState();
      if (!findDevice(s3d.model.url)) {
        selectDevice('iphone17pro');
        s3d.setBgFill({ type: 'solid', c1: '#000000', c2: '#000000' });
      }
    } else if (id === '3d' && effectId === 'mockup') setEffect('cartoon');
    setActive(id);
  };

  return (
    <aside className="card rail">
      <div className="rail-top">
        <div className="rail-logo">
          <svg width="42" height="19" viewBox="0 0 42 19" fill="none">
            <rect x="1" y="2" width="10" height="15" rx="2.5" fill="currentColor"/>
            <rect x="14" y="4.5" width="8" height="10" rx="2" fill="currentColor" opacity="0.55"/>
            <rect x="25" y="6.5" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
          </svg>
        </div>
        <button className="rail-item rail-action" onClick={newProject} title="Create a new project">
          <span className="rail-ico">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </span>
          <span className="rail-label">New</span>
        </button>
        {NAV.map((n) => (
          <button key={n.id} className={`rail-item ${active === n.id ? 'active' : ''}`} onClick={() => goNav(n.id)}>
            <span className="rail-ico">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </button>
        ))}
      </div>
      <div className="rail-bottom">
        <button
          className="rail-item rail-theme"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <span className="rail-ico">
            {theme === 'dark' ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.25" stroke="currentColor" strokeWidth="1.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15.7 12.6A6 6 0 017.4 4.3 6.1 6.1 0 1015.7 12.6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            )}
          </span>
          <span className="rail-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </aside>
  );
}
