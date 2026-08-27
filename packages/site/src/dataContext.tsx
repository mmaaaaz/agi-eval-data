import { createContext, useContext, type ReactNode } from "react";
import type { Latest, LatestState } from "./data";

/** The shell's dataset state exposed to every route inside it. */
export type DataContextValue = LatestState & { refresh: () => void };

export interface DataBag {
  data: Latest | null;
}

const Ctx = createContext<DataContextValue | null>(null);

export function DataProvider({ value, children }: { value: DataContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Throws if used outside the shell — all routes live inside it. */
export function useData(): DataContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
