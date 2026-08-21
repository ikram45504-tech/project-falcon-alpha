import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "ocean";
export type LayoutType = "layout-1" | "layout-2" | "layout-3";

interface ThemeContextType {
  mode: ThemeMode;
  layout: LayoutType;
  setMode: (m: ThemeMode) => void;
  setLayout: (l: LayoutType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("app_mode") as ThemeMode;
    return saved || "dark"; 
  });

  const [layout, setLayoutState] = useState<LayoutType>(() => {
    const saved = localStorage.getItem("app_layout") as LayoutType;
    return saved || "layout-1"; // Classic Top Nav default
  });

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem("app_mode", newMode);
  };

  const setLayout = (newLayout: LayoutType) => {
    setLayoutState(newLayout);
    localStorage.setItem("app_layout", newLayout);
  };

  useEffect(() => {
    // Map mode names to CSS data-theme attribute values
    const themeMap: Record<ThemeMode, string> = {
      light: "light",
      dark: "midnight",
      ocean: "ocean",
    };
    document.documentElement.setAttribute("data-theme", themeMap[mode]);
    document.documentElement.setAttribute("data-layout", layout);
  }, [mode, layout]);

  return (
    <ThemeContext.Provider value={{ mode, layout, setMode, setLayout }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
