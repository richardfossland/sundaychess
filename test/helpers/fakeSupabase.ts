// Minimal in-memory stand-in for the supabase-js query builder, just enough for
// lib/server/physical.ts (select/insert/update/delete + eq/order/limit/single).
// Enforces the unique constraints the migration declares (id, request_id).

type Row = Record<string, unknown>;
const UNIQUE: Record<string, string[]> = {
  physical_tournaments: ["id"],
  physical_result_reports: ["id", "request_id"],
};

export function makeFakeDb() {
  const tables: Record<string, Row[]> = { physical_tournaments: [], physical_result_reports: [] };
  let seq = 0;

  function from(name: string) {
    const rows = tables[name];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    const filters: [string, unknown][] = [];
    let single: "single" | "maybe" | null = null;
    let returning = false;
    let limitN = Infinity;
    let orderBy: [string, boolean] | null = null;

    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);

    function run(): { data: unknown; error: { code?: string; message: string } | null } {
      if (op === "insert") {
        for (const u of UNIQUE[name] ?? []) {
          if (payload[u] !== undefined && rows.some((r) => r[u] === payload[u])) return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const now = new Date().toISOString();
        const row: Row =
          name === "physical_result_reports"
            ? { id: `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`, status: "pending", created_at: now, decided_at: null, ...payload }
            : { created_at: now, updated_at: now, ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      let hit = rows.filter(match);
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, payload));
      } else if (op === "delete") {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (orderBy) hit = [...hit].sort((a, b) => (String(a[orderBy![0]]) < String(b[orderBy![0]]) ? -1 : 1) * (orderBy![1] ? 1 : -1));
      hit = hit.slice(0, limitN);
      if (single === "maybe") return { data: hit[0] ?? null, error: null };
      if (single === "single") return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: "no rows" } };
      void returning;
      return { data: hit, error: null };
    }

    const b: Record<string, unknown> = {
      select: () => ((returning = true), b),
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      delete: () => ((op = "delete"), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      order: (k: string, o?: { ascending?: boolean }) => ((orderBy = [k, o?.ascending !== false]), b),
      limit: (n: number) => ((limitN = n), b),
      single: () => ((single = "single"), b),
      maybeSingle: () => ((single = "maybe"), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }

  return { tables, client: { from } };
}
