"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import QR from "qrcode";
import { no } from "@/lib/locale/no";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { standings } from "@/lib/physical/selectors";
import {
  boardOrder, boardQrUrl, byesFor, cardsFor, certificatesFor, chunk, crossMatrix, dateText, findBoardList, fmtPoints, type CardData,
} from "@/lib/physical/print/data";
import type { PhysicalRound } from "@/lib/physical/schema";

const L = no.physicalPrint;

function Foot({ t, page, pages }: { t: PhysicalTournament; page: number; pages: number }) {
  return (
    <div className="pp-foot">
      <span>{t.title}</span>
      <span>{L.page(page, pages)}</span>
    </div>
  );
}

function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`pp-page ${className}`}>{children}</section>;
}

// ---------------- Parringsliste ----------------

const WALL_ROWS = 12;
const FIND_ROWS = 26;

export function PairingList({ t, round }: { t: PhysicalTournament; round: PhysicalRound }) {
  const name = (id: string | null) => (id ? (t.players.find((p) => p.id === id)?.name ?? "?") : "");
  const games = boardOrder(round.pairings);
  const boardPages = chunk(games, WALL_ROWS);
  const find = chunk(findBoardList(t, round), FIND_ROWS);
  const total = boardPages.length + find.length;
  const byes = byesFor(t, round);
  return (
    <>
      {boardPages.map((rows, i) => (
        <Page key={`b${i}`}>
          <h1>{L.pairingsTitle(round.number)}</h1>
          <p className="pp-sub">{t.title} · {L.byBoard}</p>
          <table className="pp-table pp-wall">
            <thead>
              <tr><th>{L.board}</th><th>{L.white}</th><th>{L.black}</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.board}>
                  <td className="pp-bn">{g.board}</td>
                  <td>{name(g.white)}</td>
                  <td>{g.black === null ? <i>{L.byeLabel}</i> : name(g.black)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {i === boardPages.length - 1 && byes.length > 0 && <p className="pp-sub" style={{ marginTop: "4mm" }}>{L.byeList(byes.join(", "))}</p>}
          <Foot t={t} page={i + 1} pages={total} />
        </Page>
      ))}
      {find.map((rows, i) => (
        <Page key={`f${i}`}>
          <h1>{L.findYourBoard}</h1>
          <p className="pp-sub">{t.title} · {L.cardRound(round.number)}</p>
          <div className="pp-find">
            {rows.map((r) => (
              <div key={r.playerId} className="pp-find-row">
                <span>
                  <b>{r.name}</b>
                  <small className="pp-find-sub">
                    {r.colour === "bye" ? L.byeLabel : r.colour ? `${r.colour === "W" ? L.white : L.black} · ${L.opponent}: ${r.opponent}` : L.notPaired}
                  </small>
                </span>
                <b style={{ fontSize: "24pt" }}>{r.board ?? "–"}</b>
              </div>
            ))}
          </div>
          <Foot t={t} page={boardPages.length + i + 1} pages={total} />
        </Page>
      ))}
    </>
  );
}

// ---------------- QR ----------------

function PrintQR({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    QR.toDataURL(value, { width: 300, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then((u) => !off && setSrc(u))
      .catch(() => !off && setSrc(null));
    return () => {
      off = true;
    };
  }, [value]);
  if (!src) return null;
  return (
    <div className="pp-qr">
      {/* eslint-disable-next-line @next/next/no-img-element -- data-URL, generert lokalt */}
      <img src={src} alt="" />
      {L.scanToReport}
    </div>
  );
}

function Boxes() {
  return (
    <div className="pp-boxes">
      <div className="pp-box">1–0<small>{L.resultWhiteWins}</small></div>
      <div className="pp-box">½–½<small>{L.resultDraw}</small></div>
      <div className="pp-box">0–1<small>{L.resultBlackWins}</small></div>
    </div>
  );
}

// ---------------- Bordkort ----------------

export function BoardCards({ t, round }: { t: PhysicalTournament; round: PhysicalRound }) {
  const cards = cardsFor(t, round);
  const pages = chunk(cards, 2);
  return (
    <>
      {pages.map((pg, i) => (
        <Page key={i}>
          <div className="pp-cards">
            {pg.map((c: CardData) => {
              const qr = boardQrUrl(t, c.round, c.board);
              return (
                <div key={c.board} className="pp-card">
                  <div className="pp-card-head">
                    <span className="pp-card-board">{L.cardBoard(c.board)}</span>
                    <span className="pp-card-round">{L.cardRound(c.round)}</span>
                  </div>
                  <div className="pp-card-players">
                    <div className="pp-side"><span className="pp-swatch pp-w" /><span>{c.white}{c.whiteGroup && <small>{c.whiteGroup}</small>}<small>{L.white}</small></span></div>
                    <div className="pp-side"><span className="pp-swatch pp-b" /><span>{c.black}{c.blackGroup && <small>{c.blackGroup}</small>}<small>{L.black}</small></span></div>
                  </div>
                  {qr ? <PrintQR value={qr} /> : <span />}
                  <Boxes />
                  <div className="pp-hint">{L.circleResult} · {t.title}</div>
                </div>
              );
            })}
          </div>
        </Page>
      ))}
    </>
  );
}

// ---------------- Resultatlapper ----------------

export function ResultSlips({ t, round, perPage }: { t: PhysicalTournament; round: PhysicalRound; perPage: number }) {
  const cards = cardsFor(t, round);
  const pages = chunk(cards, perPage);
  return (
    <>
      {pages.map((pg, i) => (
        <Page key={i}>
          <div className="pp-slips">
            {pg.map((c) => (
              <div key={c.board} className="pp-slip">
                <div className="pp-slip-no">{L.cardRound(c.round)}<b>{L.cardBoard(c.board)}</b></div>
                <div className="pp-card-players" style={{ gap: "2mm" }}>
                  <div className="pp-side"><span className="pp-swatch pp-w" />{c.white}</div>
                  <div className="pp-side"><span className="pp-swatch pp-b" />{c.black}</div>
                </div>
                <Boxes />
                <div className="pp-sign"><span>{L.signWhite}</span><span>{L.signBlack}</span></div>
              </div>
            ))}
          </div>
          <Foot t={t} page={i + 1} pages={pages.length} />
        </Page>
      ))}
    </>
  );
}

// ---------------- Tabell / sluttresultat ----------------

const STAND_ROWS = 28;

export function StandingsPages({ t, final }: { t: PhysicalTournament; final: boolean }) {
  const rows = standings(t);
  const done = t.rounds.filter((r) => r.status === "completed").length;
  const tbs = t.settings.tiebreaks;
  const pages = chunk(rows, STAND_ROWS);
  if (pages.length === 0) return <Page><h1>{L.standingsNone}</h1></Page>;
  return (
    <>
      {pages.map((pg, i) => (
        <Page key={i}>
          <h1>{final ? L.finalTitle : L.standingsTitle(done)}</h1>
          <p className="pp-sub">{t.title} · {dateText(t.events[t.events.length - 1]?.at ?? t.createdAt)}</p>
          <table className="pp-table">
            <thead>
              <tr>
                <th className="num">{L.rank}</th>
                <th>{L.name}</th>
                <th>{t.settings.groupLabel ?? "Klubb"}</th>
                <th className="num">{L.points}</th>
                {tbs.map((k) => <th key={k} className="num">{no.tiebreaks[k].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {pg.map((r) => (
                <tr key={r.playerId} style={final && r.rank <= 3 ? { fontWeight: 800 } : undefined}>
                  <td className="num">{r.rank}</td>
                  <td>{r.player.name}</td>
                  <td>{r.player.club ?? ""}</td>
                  <td className="num"><b>{fmtPoints(r.score)}</b></td>
                  {tbs.map((k) => <td key={k} className="num">{r.values[k] == null ? "–" : Number.isInteger(r.values[k]) ? r.values[k] : (r.values[k] as number).toFixed(2).replace(/0$/, "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <Foot t={t} page={i + 1} pages={pages.length} />
        </Page>
      ))}
    </>
  );
}

// ---------------- Krysstabell ----------------

export function CrosstablePage({ t }: { t: PhysicalTournament }) {
  const m = crossMatrix(t);
  const n = m.rows.length;
  const font = n <= 12 ? 11 : n <= 20 ? 9 : n <= 28 ? 7.5 : 6;
  return (
    <Page>
      <h1 style={{ fontSize: "22pt" }}>{L.crosstableTitle}</h1>
      <p className="pp-sub" style={{ marginBottom: "3mm" }}>{t.title}</p>
      <table className="pp-table pp-cross" style={{ fontSize: `${font}pt` }}>
        <thead>
          <tr>
            <th>{L.rank}</th>
            <th className="pp-name">{L.name}</th>
            {m.rows.map((_, i) => <th key={i}>{i + 1}</th>)}
            <th>{L.points}</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r, ri) => (
            <tr key={r.playerId}>
              <td>{ri + 1}</td>
              <td className="pp-name">{r.name}</td>
              {r.cells.map((c, ci) => (
                <Fragment key={ci}>{c === null ? <td className="pp-diag" /> : <td>{c}</td>}</Fragment>
              ))}
              <td><b>{fmtPoints(r.score)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Foot t={t} page={1} pages={1} />
    </Page>
  );
}

// ---------------- Diplomer ----------------

export function Certificates({ t, participants }: { t: PhysicalTournament; participants: boolean }) {
  const certs = certificatesFor(t, { participants });
  const date = dateText(t.events[t.events.length - 1]?.at ?? t.createdAt);
  if (certs.length === 0) return <Page><h1>{L.standingsNone}</h1></Page>;
  return (
    <>
      {certs.map((c) => (
        <Page key={c.playerId} className="pp-cert">
          <div className="pp-cert-frame">
            <div className="pp-cert-orn">♔</div>
            <h1 className="pp-cert-title">{c.kind === "place" ? L.diplomaTitle : L.diplomaParticipant}</h1>
            {c.kind === "place" && <div className="pp-cert-place">{c.shared ? L.diplomaShared(c.rank!) : L.diplomaPlace(c.rank!)}</div>}
            <div className="pp-cert-text">{L.diplomaFor}</div>
            <div className="pp-cert-name">{c.name}</div>
            <div className="pp-cert-text">
              {c.kind === "place" ? L.diplomaPlaceText(t.title) : L.diplomaParticipantText(t.title)}
              {c.kind === "place" && <><br />{L.diplomaPoints(fmtPoints(c.score))}</>}
            </div>
            <div className="pp-cert-meta">
              <span>{date}</span>
              <span className="pp-cert-sig">{L.diplomaSignature}</span>
            </div>
          </div>
        </Page>
      ))}
    </>
  );
}
