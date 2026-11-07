// ONE place for date/time formatting. Always nb-NO (the UI is Norwegian; "no",
// "no-NO" and "nb-NO" used to be mixed across files).
export const DATE_LOCALE = "nb-NO";

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Norwegian date. Default numeric («5.11.2026»); pass Intl options for e.g.
 * { day: "numeric", month: "long", year: "numeric" } («5. november 2026»).
 * Returns "" for an invalid date. */
export function formatDate(d: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(DATE_LOCALE, opts);
}

/** Norwegian time of day in the viewer's timezone. Returns "" for an invalid date. */
export function formatTime(d: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(DATE_LOCALE, opts);
}
