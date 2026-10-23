"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";

type GuardApi = {
  /** Editors report whether their draft differs from what is saved. */
  register: (key: string, dirty: boolean) => void;
  /** True when any editor currently holds unsaved edits. */
  isDirty: () => boolean;
  /**
   * Runs `proceed` immediately when nothing is dirty; otherwise asks first.
   * Returns true when it handled the request by asking.
   */
  guard: (proceed: () => void) => boolean;
};

const UnsavedChangesContext = createContext<GuardApi | null>(null);

/**
 * One "Discard changes?" conversation for the whole dashboard.
 *
 * Dirty state lives in a ref rather than React state on purpose: editors
 * report it from an effect, and storing it in state there would mean calling
 * setState inside an effect on every keystroke.
 */
export function UnsavedChangesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dirty = useRef(new Map<string, boolean>());
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const isDirty = useCallback(
    () => [...dirty.current.values()].some(Boolean),
    [],
  );

  const register = useCallback((key: string, value: boolean) => {
    if (value) dirty.current.set(key, true);
    else dirty.current.delete(key);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    const target = opener.current;
    opener.current = null;
    requestAnimationFrame(() => target?.focus());
  }, []);

  const guard = useCallback(
    (proceed: () => void) => {
      if (!isDirty()) {
        proceed();
        return false;
      }
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setRequest({
        title: "Discard changes?",
        body: "You have edits that haven’t been saved. Leaving now throws them away.",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        tone: "danger",
        onConfirm: () => {
          dirty.current.clear();
          proceed();
        },
      });
      return true;
    },
    [isDirty],
  );

  // Covers closing the tab or a hard reload, which no router hook can see.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const value = useMemo<GuardApi>(
    () => ({ register, isDirty, guard }),
    [register, isDirty, guard],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <ConfirmDialog request={request} onClose={close} />
    </UnsavedChangesContext.Provider>
  );
}

function useGuardApi() {
  const value = useContext(UnsavedChangesContext);
  if (!value)
    throw new Error(
      "useUnsavedChanges must be used inside UnsavedChangesProvider",
    );
  return value;
}

/**
 * Editors call this with their own dirty flag. Saving or discarding flips the
 * flag to false, so the guard stops asking without any extra bookkeeping.
 */
export function useUnsavedChanges(key: string, dirty: boolean) {
  const { register } = useGuardApi();
  useEffect(() => {
    register(key, dirty);
    return () => register(key, false);
  }, [key, dirty, register]);
}

/** For links and buttons that navigate away from an editor. */
export function useNavigationGuard() {
  const { guard, isDirty } = useGuardApi();
  const router = useRouter();

  /**
   * Drop-in for <Link onNavigate>. With nothing dirty it stays out of the way
   * and lets the Link navigate itself — calling router.push here as well would
   * navigate twice.
   */
  const onNavigate = useCallback(
    (href: string) => (event: { preventDefault: () => void }) => {
      if (!isDirty()) return;
      event.preventDefault();
      guard(() => router.push(href));
    },
    [guard, isDirty, router],
  );

  return { guard, onNavigate };
}
