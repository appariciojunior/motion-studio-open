import { create } from 'zustand';

// Lightweight UI-only state (which nav section is active). Kept separate from
// the 2D scene store so 3D mode doesn't couple to motion/template state.
export interface UIState {
  nav: string;              // active IconRail section id
  theme: 'light' | 'dark';
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  tplCollapsed: boolean;    // left column folded to the original compact strip
  mobileTab: 'templates' | 'media' | 'adjust' | 'canvas';
  mobileProjectsOpen: boolean;
  mobilePanelOpen: boolean;
  setNav: (nav: string) => void;
  toggleTheme: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleTplCollapsed: () => void;
  setMobileTab: (tab: UIState['mobileTab']) => void;
  setMobileProjectsOpen: (open: boolean) => void;
  setMobilePanelOpen: (open: boolean) => void;
  hydratePreferences: () => void;
}

const PREFS_KEY = 'motion-ui-preferences';

type UIPreferences = Pick<UIState, 'theme' | 'leftCollapsed' | 'rightCollapsed' | 'tplCollapsed'>;

function savePreferences(prefs: UIPreferences) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREFS_KEY, JSON.stringify({
    theme: prefs.theme,
    leftCollapsed: prefs.leftCollapsed,
    rightCollapsed: prefs.rightCollapsed,
    tplCollapsed: prefs.tplCollapsed,
  }));
  document.documentElement.dataset.theme = prefs.theme;
}

export const useUIStore = create<UIState>((set) => ({
  nav: 'library',
  theme: 'light',
  leftCollapsed: false,
  rightCollapsed: false,
  tplCollapsed: false,
  mobileTab: 'templates',
  mobileProjectsOpen: false,
  mobilePanelOpen: false,
  setNav: (nav) => set({ nav }),
  toggleTheme: () => set((state) => {
    const next = { ...state, theme: state.theme === 'dark' ? 'light' as const : 'dark' as const };
    savePreferences(next);
    return { theme: next.theme };
  }),
  toggleLeftPanel: () => set((state) => {
    const next = { ...state, leftCollapsed: !state.leftCollapsed };
    savePreferences(next);
    return { leftCollapsed: next.leftCollapsed };
  }),
  toggleRightPanel: () => set((state) => {
    const next = { ...state, rightCollapsed: !state.rightCollapsed };
    savePreferences(next);
    return { rightCollapsed: next.rightCollapsed };
  }),
  toggleTplCollapsed: () => set((state) => {
    const next = { ...state, tplCollapsed: !state.tplCollapsed };
    savePreferences(next);
    return { tplCollapsed: next.tplCollapsed };
  }),
  setMobileTab: (mobileTab) => set({ mobileTab, mobilePanelOpen: true }),
  setMobileProjectsOpen: (mobileProjectsOpen) => set({ mobileProjectsOpen }),
  setMobilePanelOpen: (mobilePanelOpen) => set({ mobilePanelOpen }),
  hydratePreferences: () => set((state) => {
    if (typeof window === 'undefined') return {};
    let saved: Partial<UIPreferences> = {};
    try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); } catch { /* use defaults */ }
    const theme = saved.theme === 'dark' || saved.theme === 'light'
      ? saved.theme
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const next = {
      theme,
      leftCollapsed: saved.leftCollapsed ?? state.leftCollapsed,
      rightCollapsed: saved.rightCollapsed ?? state.rightCollapsed,
      tplCollapsed: saved.tplCollapsed ?? state.tplCollapsed,
    };
    savePreferences({ ...state, ...next });
    return next;
  }),
}));
