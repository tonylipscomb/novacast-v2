import { createContext, useContext, type PropsWithChildren } from 'react';

const StartupVisualGateContext = createContext(true);

export function StartupVisualGateProvider({
  interactive,
  children,
}: PropsWithChildren<{ interactive: boolean }>) {
  return (
    <StartupVisualGateContext.Provider value={interactive}>
      {children}
    </StartupVisualGateContext.Provider>
  );
}

export function useStartupVisualInteractive(): boolean {
  return useContext(StartupVisualGateContext);
}
