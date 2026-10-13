/** The public API origin is build-time configuration, never a private credential. */
export const apiUrl =
  import.meta.env.VITE_LIGHTBAKER_API_URL?.trim() ||
  (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");
