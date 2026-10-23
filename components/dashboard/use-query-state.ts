"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

function urlWith(search: URLSearchParams) {
  const qs = search.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

/**
 * Dashboard state worth keeping in the URL, so Back, Forward and a refresh all
 * land where the owner expects.
 *
 * Every write preserves the other parameters — the Connections page used to
 * clear the whole query string to drop an OAuth result, taking the expanded
 * connector with it.
 *
 * `history: "push"` for discrete choices a person would expect Back to undo;
 * "replace" for things typed or toggled rapidly, which would otherwise bury
 * the previous page under dozens of history entries.
 */
export function useQueryState(
  key: string,
  { history = "push" }: { history?: "push" | "replace" } = {},
) {
  const params = useSearchParams();
  const router = useRouter();
  const value = params.get(key);

  const set = useCallback(
    (next: string | null) => {
      const search = new URLSearchParams(params.toString());
      if (next === null || next === "") search.delete(key);
      else search.set(key, next);
      const url = urlWith(search);
      if (history === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, key, history, router],
  );

  return [value, set] as const;
}

/**
 * Removes one-shot parameters (an OAuth result, say) once their message has
 * been shown, leaving every other parameter in place.
 */
export function useDropTransientParams() {
  const params = useSearchParams();
  const router = useRouter();

  return useCallback(
    (keys: string[]) => {
      const search = new URLSearchParams(params.toString());
      let changed = false;
      for (const key of keys) {
        if (search.has(key)) {
          search.delete(key);
          changed = true;
        }
      }
      if (changed) router.replace(urlWith(search), { scroll: false });
    },
    [params, router],
  );
}
