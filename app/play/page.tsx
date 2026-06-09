"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError } from "@/lib/client/api";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { isValidPin } from "@/lib/codes";
import { WaitingRoom } from "./WaitingRoom";

type Screen = "init" | "join" | "name" | "showCode" | "resume" | "playing";

export default function Play() {
  const [screen, setScreen] = useState<Screen>("init");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [me, setMe] = useState<StoredPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, try to restore a stored session.
  useEffect(() => {
    const stored = identity.player();
    if (!stored) {
      // Init from localStorage on mount — intended one-time setup.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScreen("join");
      return;
    }
    api
      .resume(stored.resumeCode, { tournamentId: stored.tournamentId })
      .then((r) => {
        const next: StoredPlayer = {
          tournamentId: r.tournamentId,
          playerId: r.playerId,
          resumeCode: stored.resumeCode,
          displayName: r.displayName,
        };
        identity.savePlayer(next);
        setMe(next);
        setScreen("playing");
      })
      .catch(() => {
        identity.clearPlayer();
        setScreen("join");
      });
  }, []);

  function goName() {
    setError(null);
    if (!isValidPin(pin)) {
      setError(no.player.invalidPin);
      return;
    }
    setScreen("name");
  }

  async function doJoin() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(pin, name.trim());
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("showCode");
    } catch (e) {
      const errCode = e instanceof ApiError ? e.code : "";
      setError(
        errCode === "invalid_pin"
          ? no.player.invalidPin
          : errCode === "already_started"
            ? "Turneringen har allerede startet."
            : no.common.error,
      );
      setBusy(false);
      if (errCode === "invalid_pin") setScreen("join");
    } finally {
      setBusy(false);
    }
  }

  async function doResume() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.resume(code, { pin });
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: code.toUpperCase(),
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("playing");
    } catch {
      setError(no.player.invalidCode);
      setBusy(false);
    }
  }

  if (screen === "init") {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  if (screen === "playing" && me) {
    return (
      <WaitingRoom
        me={me}
        onLeave={() => {
          identity.clearPlayer();
          setMe(null);
          setScreen("join");
        }}
      />
    );
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack">
        <Link href="/" className="brandmark">
          Sunday<b>Sjakk</b>
        </Link>

        {screen === "join" && (
          <>
            <p className="eyebrow">{no.player.joinTitle}</p>
            <div className="field">
              <label htmlFor="pin">{no.host.pinLabel}</label>
              <input
                id="pin"
                className="input input-pin"
                inputMode="numeric"
                maxLength={6}
                placeholder="------"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && goName()}
              />
            </div>
            <button className="btn btn-primary btn-block btn-lg" onClick={goName}>
              {no.player.join}
            </button>
            <button
              className="btn btn-ghost btn-block"
              onClick={() => {
                setScreen("resume");
                setError(null);
              }}
            >
              {no.player.haveCode}
            </button>
          </>
        )}

        {screen === "name" && (
          <>
            <p className="eyebrow">{no.player.nameTitle}</p>
            <div className="field">
              <label htmlFor="nm">{no.player.namePlaceholder}</label>
              <input
                id="nm"
                className="input"
                maxLength={40}
                autoFocus
                placeholder={no.player.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && doJoin()}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {no.player.nameHint}
              </span>
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !name.trim()}
              onClick={doJoin}
            >
              {busy ? <span className="spin" /> : no.player.join}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("join")}>
              {no.common.back}
            </button>
          </>
        )}

        {screen === "showCode" && me && (
          <>
            <p className="eyebrow">{no.player.resumeTitle}</p>
            <div className="big-code text-center" style={{ padding: "12px 0" }}>
              {me.resumeCode}
            </div>
            <div className="banner banner-wait">{no.player.resumeHint}</div>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => setScreen("playing")}
            >
              {no.player.resumeAck}
            </button>
          </>
        )}

        {screen === "resume" && (
          <>
            <p className="eyebrow">{no.player.resume}</p>
            <div className="field">
              <label htmlFor="rpin">{no.host.pinLabel}</label>
              <input
                id="rpin"
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-sifret PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <div className="field">
              <label htmlFor="rc">{no.player.resumePlaceholder}</label>
              <input
                id="rc"
                className="input"
                placeholder={no.player.resumePlaceholder}
                value={code}
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !code.trim() || !isValidPin(pin)}
              onClick={doResume}
            >
              {busy ? <span className="spin" /> : no.player.resume}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("join")}>
              {no.common.back}
            </button>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
      </div>
    </main>
  );
}
