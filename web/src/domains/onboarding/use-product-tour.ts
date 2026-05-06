import { useEffect, useState, useCallback } from "react";

import {
  clearProductTourState,
  readProductTourState,
  writeProductTourState,
  type ProductTourState,
} from "./product-tour-state";

export function useProductTour(): {
  state: ProductTourState;
  setState: (next: ProductTourState) => void;
  reset: () => void;
} {
  const [state, setLocalState] = useState<ProductTourState>(readProductTourState);

  useEffect(() => {
    function handle() {
      setLocalState(readProductTourState());
    }
    window.addEventListener("rocky:tour-state", handle);
    window.addEventListener("storage", handle);
    return () => {
      window.removeEventListener("rocky:tour-state", handle);
      window.removeEventListener("storage", handle);
    };
  }, []);

  const setState = useCallback((next: ProductTourState) => {
    writeProductTourState(next);
    setLocalState(next);
  }, []);

  const reset = useCallback(() => {
    clearProductTourState();
    setLocalState("not-started");
  }, []);

  return { state, setState, reset };
}
