"use client";

import { PhysicalBoard } from "./PhysicalBoard";
import { PhysicalList } from "./PhysicalList";
import { PhysicalWizard } from "./PhysicalWizard";
import { useClientPath } from "./nav";
import { PrintView } from "./print/PrintView";
import { Storskjerm } from "./storskjerm/Storskjerm";

const BASE = "/arranger/fysisk";

export function PhysicalApp() {
  const path = useClientPath();
  if (!path) return <main className="center-screen"><span className="spin" /></main>;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length).replace(/^\/+|\/+$/g, "") : "";
  if (!rest) return <PhysicalList />;
  if (rest === "ny") return <PhysicalWizard />;
  const parts = rest.split("/");
  const id = decodeURIComponent(parts[0]);
  if (parts[1] === "storskjerm") return <Storskjerm id={id} />;
  if (parts[1] === "skriv") return <PrintView id={id} kind={decodeURIComponent(parts[2] ?? "")} />;
  return <PhysicalBoard id={id} />;
}
