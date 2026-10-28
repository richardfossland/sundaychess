import { no } from "@/lib/locale/no";

export type PhysicalErrorCode = keyof typeof no.physical.errors;

/** Typet feil med norsk melding. `code` er stabil for tester/UI; `message` vises til brukeren. */
export class PhysicalError extends Error {
  readonly code: PhysicalErrorCode;
  constructor(code: PhysicalErrorCode) {
    super(no.physical.errors[code]);
    this.name = "PhysicalError";
    this.code = code;
  }
}

export function fail(code: PhysicalErrorCode): never {
  throw new PhysicalError(code);
}
