const STORAGE_KEY = "rocky.product-tour.v2.state";

export type ProductTourState = "not-started" | "completed";

const NOT_STARTED: ProductTourState = "not-started";

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readProductTourState(): ProductTourState {
  if (!isBrowserStorageAvailable()) return NOT_STARTED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "completed" || raw === "not-started") return raw;
    return NOT_STARTED;
  } catch {
    return NOT_STARTED;
  }
}

export function writeProductTourState(next: ProductTourState): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent("rocky:tour-state"));
  } catch {
    // ignore
  }
}

export function clearProductTourState(): void {
  if (!isBrowserStorageAvailable()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("rocky:tour-state"));
}
