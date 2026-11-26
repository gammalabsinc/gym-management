import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One save at a time. A second call while one is running is ignored, so a double tap adds one
 * member. The flag is a ref as well as state, because two taps can land before a render.
 */
export function useSave<T>() {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (work: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    try {
      return await work();
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }, []);

  return { saving, run, isMounted: () => mounted.current };
}
