"use client";

import { PhysicalBoard } from "./PhysicalBoard";
import { PhysicalList } from "./PhysicalList";
import { PhysicalWizard } from "./PhysicalWizard";
import { useClientPath } from "./nav";

const BASE = "/arranger/fysisk";

export function PhysicalApp() {
  const path = useClientPath();
  if (!path) return <main className="center-screen"><span className="spin" /></main>;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length).replace(/^\/+|\/+$/g, "") : "";
  if (!rest) return <PhysicalList />;
  if (rest === "ny") return <PhysicalWizard />;
  return <PhysicalBoard id={decodeURIComponent(rest.split("/")[0])} />;
}
