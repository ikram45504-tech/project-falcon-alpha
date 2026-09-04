import { useEffect, useState } from "react";

export type ControlTheme = "dark" | "ocean";

const STORAGE_KEY = "travelHisabControlTheme";
const LEGACY_KEY = "travelHisabControlThemeLegacyV1";

export function readControlTheme(): ControlTheme {
  if (typeof window === "undefined") return "dark";

  // One-time: old "ocean" was the deep teal look — keep that preference as Dark.
  if (!localStorage.getItem(LEGACY_KEY)) {
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous === "ocean") {
      localStorage.setItem(STORAGE_KEY, "dark");
    }
    localStorage.setItem(LEGACY_KEY, "1");
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "ocean" ? "ocean" : "dark";
}

export function writeControlTheme(theme: ControlTheme) {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function useControlTheme() {
  const [theme, setThemeState] = useState<ControlTheme>(() => readControlTheme());

  useEffect(() => {
    writeControlTheme(theme);
  }, [theme]);

  const setTheme = (next: ControlTheme) => setThemeState(next);

  return { theme, setTheme };
}
