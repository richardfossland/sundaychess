"use client";

import { useState } from "react";
import { no } from "@/lib/locale/no";
import { NavLink } from "../nav";
import { usePhysicalTournament } from "../usePhysical";
import { useBoardKeys } from "../cloud/useBoardKeys";
import { isPrintKind, pickRound, type PrintKind } from "@/lib/physical/print/data";
import { BoardCards, Certificates, CrosstablePage, PairingList, ResultSlips, StandingsPages } from "./PrintViews";
import "./print.css";

const L = no.physicalPrint;
const LANDSCAPE: PrintKind[] = ["krysstabell", "diplomer"];

function readParams() {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const r = Number(q.get("runde"));
  const per = Number(q.get("per"));
  return {
    round: Number.isInteger(r) && r > 0 ? r : null,
    per: per >= 2 && per <= 4 ? per : 4,
    participants: q.get("deltaker") === "1",
  };
}

/** /arranger/fysisk/<id>/skriv/<type>?runde=N&per=4&deltaker=1 – virker helt uten nett. */
export function PrintView({ id, kind }: { id: string; kind: string }) {
  const { state: t, status } = usePhysicalTournament(id);
  const [params, setParams] = useState(readParams);
  useBoardKeys(t, kind === "bordkort" && t ? pickRound(t, params.round)?.number ?? null : null);

  function update(patch: Partial<typeof params>) {
    const next = { ...params, ...patch };
    setParams(next);
    const q = new URLSearchParams();
    if (next.round) q.set("runde", String(next.round));
    if (next.per !== 4) q.set("per", String(next.per));
    if (next.participants) q.set("deltaker", "1");
    const s = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (s ? `?${s}` : ""));
  }

  if (status === "loading") return <main className="center-screen"><span className="spin" /></main>;
  const back = `/arranger/fysisk/${encodeURIComponent(id)}`;
  if (status !== "ready" || !t) {
    return <div className="pp-root"><div className="pp-empty">{L.notFound} <NavLink href="/arranger/fysisk">{no.physical.backToList}</NavLink></div></div>;
  }
  if (!isPrintKind(kind)) {
    return <div className="pp-root"><div className="pp-empty">{L.unknownKind} <NavLink href={back}>{L.toolbarBack}</NavLink></div></div>;
  }

  const round = pickRound(t, params.round);
  const needsRound = kind === "parringsliste" || kind === "bordkort" || kind === "resultatlapper";
  const landscape = LANDSCAPE.includes(kind);

  let body;
  if (needsRound && !round) body = <div className="pp-empty">{L.noRounds}</div>;
  else if (kind === "parringsliste") body = <PairingList t={t} round={round!} />;
  else if (kind === "bordkort") body = <BoardCards t={t} round={round!} />;
  else if (kind === "resultatlapper") body = <ResultSlips t={t} round={round!} perPage={params.per} />;
  else if (kind === "tabell") body = <StandingsPages t={t} final={false} />;
  else if (kind === "sluttresultat") body = <StandingsPages t={t} final />;
  else if (kind === "krysstabell") body = <CrosstablePage t={t} />;
  else body = <Certificates t={t} participants={params.participants} />;

  return (
    <div className={`pp-root ${landscape ? "pp-landscape" : ""}`} data-print-kind={kind}>
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 0; }`}</style>
      <div className="pp-toolbar">
        <NavLink href={back}>{L.toolbarBack}</NavLink>
        <strong>{L.kinds[kind]}</strong>
        {needsRound && t.rounds.length > 0 && (
          <label>
            {L.roundLabel}{" "}
            <select value={round?.number ?? ""} onChange={(e) => update({ round: Number(e.target.value) })}>
              {t.rounds.map((r) => <option key={r.number} value={r.number}>{r.number}</option>)}
            </select>
          </label>
        )}
        {kind === "resultatlapper" && (
          <label>
            {L.perPage}{" "}
            <select value={params.per} onChange={(e) => update({ per: Number(e.target.value) })}>
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {kind === "diplomer" && (
          <label>
            <input type="checkbox" checked={params.participants} onChange={(e) => update({ participants: e.target.checked })} /> {L.participants}
          </label>
        )}
        <button type="button" className="pp-print-btn" onClick={() => window.print()}>{L.toolbarPrint}</button>
      </div>
      <div className="pp-pages">{body}</div>
    </div>
  );
}
