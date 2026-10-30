import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  announcePulled,
  LOCAL_WRITE_EVENT,
  WORKSPACE_PULLED_EVENT,
  persistLocal,
} from "../lib/workspace-documents";

/**
 * A window just real enough for these events. The repo has no DOM test
 * environment and this does not need one: the module dispatches on window
 * and nothing else.
 */
beforeAll(() => {
  const target = new EventTarget();
  Object.assign(globalThis, {
    window: target,
    localStorage: {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
    },
  });
});

/**
 * Two different things happen to a workspace document, and conflating them
 * breaks in opposite directions.
 *
 * "This browser edited something" has to be pushed up. "The server changed
 * and we took the new copy" must not be — announcing a pull on the write
 * event would send the server's own copy straight back, and anything
 * listening would have to guess which direction the change came from.
 */
describe("telling a local edit from a pull", () => {
  it("announces a pull without claiming anything was written here", () => {
    const pulled = vi.fn();
    const written = vi.fn();
    window.addEventListener(WORKSPACE_PULLED_EVENT, pulled);
    window.addEventListener(LOCAL_WRITE_EVENT, written);

    announcePulled("workflows");

    expect(pulled).toHaveBeenCalledOnce();
    expect(written).not.toHaveBeenCalled();
    window.removeEventListener(WORKSPACE_PULLED_EVENT, pulled);
    window.removeEventListener(LOCAL_WRITE_EVENT, written);
  });

  it("still announces a local write as one", () => {
    const pulled = vi.fn();
    const written = vi.fn();
    window.addEventListener(WORKSPACE_PULLED_EVENT, pulled);
    window.addEventListener(LOCAL_WRITE_EVENT, written);

    persistLocal("workflows", { formatVersion: 2, workflows: [] });

    expect(written).toHaveBeenCalledOnce();
    expect(pulled).not.toHaveBeenCalled();
    window.removeEventListener(WORKSPACE_PULLED_EVENT, pulled);
    window.removeEventListener(LOCAL_WRITE_EVENT, written);
  });

  it("says which document changed", () => {
    // A listener for one document must not redraw for another.
    const seen: string[] = [];
    const onPulled = (event: Event) =>
      seen.push(
        (event as CustomEvent<{ key?: string }>).detail?.key ?? "none",
      );
    window.addEventListener(WORKSPACE_PULLED_EVENT, onPulled);

    announcePulled("knowledge");
    announcePulled("workflows");

    expect(seen).toEqual(["knowledge", "workflows"]);
    window.removeEventListener(WORKSPACE_PULLED_EVENT, onPulled);
  });
});
