import { createContext, useContext } from 'react';

const ThemeContext = createContext({});

export function ThemeProvider({ children }) {
  // Phase 1: static dark theme via CSS variables (no API)
  // Phase 2: will fetch from /api/config/theme like HRAPR
  return (
    <ThemeContext.Provider value={{}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
