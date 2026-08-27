import type { MetroGraph, RouteResult } from "./routing";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * Derive difficulty from RouteResult per Pass 2 §3.4.
 * Human-overridable; this is only the auto-suggested badge.
 */
export function difficultyOf(result: RouteResult, graph?: MetroGraph): Difficulty {
  const { hops, transfers } = result;

  // Check branching on path if graph provided
  let branching = false;
  if (graph) {
    for (const id of result.path) {
      const degree = graph.adj.get(id)?.length ?? 0;
      if (degree >= 3) {
        branching = true;
        break;
      }
    }
  }

  // Easy: hops <=2 or transfers==0 && hops<=4
  if (hops <= 2 || (transfers === 0 && hops <= 4)) return "easy";
  // Hard: hops>=7 or transfers>=2 or branching degree>=3 on path
  if (hops >= 7 || transfers >= 2 || branching) return "hard";
  // Medium: everything else (hops 3-6 or transfers==1)
  return "medium";
}
