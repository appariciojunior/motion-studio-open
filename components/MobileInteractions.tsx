'use client';

import { createContext, useContext } from 'react';

const MobileInteractionContext = createContext(false);

export function MobileInteractionProvider({ children }: { children: React.ReactNode }) {
  return <MobileInteractionContext.Provider value>{children}</MobileInteractionContext.Provider>;
}

export function useMobileInteractions() {
  return useContext(MobileInteractionContext);
}
