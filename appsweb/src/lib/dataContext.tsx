import { createContext, useContext, type ReactNode } from "react";
import { type LatestState } from "./data";

const Ctx = createContext<LatestState & { refresh: () => void } | null>(null);

export function DataProvider({ value, children }: { value: LatestState & { refresh: () => void }; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Throws if used outside the shell — all routes live inside it. */
export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
