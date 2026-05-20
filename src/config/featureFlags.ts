export function isFetchrRedesignEnabled(): boolean {
  const value = import.meta.env.FETCHR_UI_REDESIGN ?? import.meta.env.VITE_FETCHR_UI_REDESIGN;
  const normalized = String(value ?? "true").trim().toLowerCase();
  return !["0", "false", "off", "legacy"].includes(normalized);
}
