"use client";

import { useThemePreference } from "@/components/theme-provider";

export function ThemeControl() {
  const { theme, setTheme, persistenceError } = useThemePreference();

  return (
    <div className="theme-control">
      <label htmlFor="theme-preference">Appearance</label>
      <select
        id="theme-preference"
        value={theme}
        onChange={(event) => {
          const selected = event.currentTarget.value;
          if (
            selected === "system" ||
            selected === "light" ||
            selected === "dark"
          ) {
            setTheme(selected);
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      {persistenceError ? (
        <span role="status" className="theme-control-error">
          Could not save preference
        </span>
      ) : null}
    </div>
  );
}
