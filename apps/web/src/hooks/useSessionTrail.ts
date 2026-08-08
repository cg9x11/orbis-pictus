import { useCallback, useState } from "react";
import type { Node } from "@orbis/shared";

interface TrailState {
  trail: Node[];
  currentIndex: number;
}

/** Linear session history with back/forward navigation, truncate-on-branch. */
export function useSessionTrail(initial: Node[] = []) {
  const [state, setState] = useState<TrailState>(() => ({
    trail: initial,
    currentIndex: initial.length - 1,
  }));

  /** Appends a new page after the current position, discarding any forward history. */
  const append = useCallback((node: Node) => {
    setState((prev) => {
      const trail = [...prev.trail.slice(0, prev.currentIndex + 1), node];
      return { trail, currentIndex: trail.length - 1 };
    });
  }, []);

  const navigateTo = useCallback((index: number) => {
    setState((prev) => (index >= 0 && index < prev.trail.length ? { ...prev, currentIndex: index } : prev));
  }, []);

  const reset = useCallback((nodes: Node[] = []) => {
    setState({ trail: nodes, currentIndex: nodes.length - 1 });
  }, []);

  /** Replaces a node already in the trail with an updated copy (e.g. after fetching a new image variant). */
  const updateNode = useCallback((updated: Node) => {
    setState((prev) => ({
      ...prev,
      trail: prev.trail.map((n) => (n.id === updated.id ? updated : n)),
    }));
  }, []);

  return {
    trail: state.trail,
    currentIndex: state.currentIndex,
    current: state.currentIndex >= 0 ? state.trail[state.currentIndex] : undefined,
    append,
    navigateTo,
    reset,
    updateNode,
  };
}
