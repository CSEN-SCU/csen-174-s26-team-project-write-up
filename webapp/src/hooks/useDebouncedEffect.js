import { useEffect, useRef } from "react";

/** Run callback after `delay` ms when `deps` change; resets timer on each change. */
export function useDebouncedEffect(deps, delay, onFire) {
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  useEffect(() => {
    const t = setTimeout(() => onFireRef.current(), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}
