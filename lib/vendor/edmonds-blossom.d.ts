/** Maksimal vektet matching. `edges` = [i, j, vekt] mellom heltallsnoder 0..n-1.
 * Returnerer `mate`: mate[i] = partnerens node, eller -1 uten partner. */
export default function maxWeightMatching(
  edges: [number, number, number][],
  maxCardinality?: boolean,
): number[];
