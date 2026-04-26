import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppMode = "normal" | "debug";

const APP_MODE_STORAGE_KEY = "rocky_app_mode";

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

function readStoredMode(): AppMode {
  if (typeof window === "undefined") {
    return "normal";
  }

  const stored = window.localStorage.getItem(APP_MODE_STORAGE_KEY);
  return stored === "debug" ? "debug" : "normal";
}

export function AppModeProvider(props: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(() => readStoredMode());

  const setMode = useCallback((nextMode: AppMode) => {
    setModeState(nextMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(APP_MODE_STORAGE_KEY, nextMode);
    }
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
    }),
    [mode, setMode]
  );

  return <AppModeContext.Provider value={value}>{props.children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const value = useContext(AppModeContext);
  if (!value) {
    throw new Error("useAppMode must be used within an AppModeProvider.");
  }

  return value;
}
