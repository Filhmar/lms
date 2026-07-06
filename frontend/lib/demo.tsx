"use client";

/**
 * Demo/state harness — mirrors the interactive prototype's simulation props
 * (theme / connectivity / iosMode / batteryLow) so every designed state can
 * be exercised without a backend. Persisted to localStorage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Connectivity = "online" | "slow-2g" | "offline";
export type Theme = "light" | "dark";

export interface DemoState {
  theme: Theme;
  connectivity: Connectivity;
  iosMode: boolean;
  batteryLow: boolean;
}

const DEFAULTS: DemoState = {
  theme: "light",
  connectivity: "online",
  iosMode: false,
  batteryLow: false,
};

const STORAGE_KEY = "resilient-learn-demo-settings";

interface DemoContextValue extends DemoState {
  set: <K extends keyof DemoState>(key: K, value: DemoState[K]) => void;
}

const DemoContext = createContext<DemoContextValue>({
  ...DEFAULTS,
  set: () => {},
});

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<DemoState>) });
    } catch {
      /* first run */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  const set = useCallback(
    <K extends keyof DemoState>(key: K, value: DemoState[K]) =>
      setState((s) => ({ ...s, [key]: value })),
    [],
  );

  return <DemoContext.Provider value={{ ...state, set }}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  return useContext(DemoContext);
}

/** True whenever the demo says there is any signal at all. */
export function useOnline() {
  const { connectivity } = useDemo();
  return connectivity !== "offline";
}
