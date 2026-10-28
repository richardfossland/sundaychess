// Migreringskrok for filformatet. Hver nøkkel `n` løfter en fil fra schemaVersion n til n+1
// (på det ukonverterte JSON-objektet). I dag finnes bare v1, så registeret er tomt; en
// fremtidig v2 legger til `1: (f) => ({ ...f, schemaVersion: 2, ... })`.

import { no } from "@/lib/locale/no";
import { SCHEMA_VERSION } from "@/lib/physical/schema";

export type FileMigration = (file: Record<string, unknown>) => Record<string, unknown>;
export const FILE_MIGRATIONS: Record<number, FileMigration> = {};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export function migrateFile(
  raw: Record<string, unknown>,
  current: number = SCHEMA_VERSION,
  migrations: Record<number, FileMigration> = FILE_MIGRATIONS,
): Record<string, unknown> {
  const e = no.physical.file.errors;
  let v = raw.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new ImportError(e.versionMissing);
  if (v > current) throw new ImportError(e.versionTooNew(v));
  let file = raw;
  while (v < current) {
    const step = migrations[v];
    if (!step) throw new ImportError(e.versionUnsupported(v));
    file = step(file);
    if (file.schemaVersion !== v + 1) file = { ...file, schemaVersion: v + 1 };
    v += 1;
  }
  return file;
}
