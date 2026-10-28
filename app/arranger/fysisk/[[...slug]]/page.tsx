import { PhysicalApp } from "../PhysicalApp";

// Én klientside for liste, veiviser og turneringsvisning. Ingen serverdata:
// service workeren serverer samme forhåndscachede skall for alle stier under
// /arranger/fysisk/* når nettet er borte, så visningen velges på klienten.
export default function PhysicalPage() {
  return <PhysicalApp />;
}
