"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError } from "@/lib/client/api";
import { Wizard } from "./Wizard";

export default function HostEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "open">("create");
  const [hostCode, setHostCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.openHost(hostCode);
      router.push(`/host/${r.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "not_found"
          ? no.player.invalidCode
          : no.common.error,
      );
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack">
        <Link href="/" className="brandmark">
          Sunday<b>Sjakk</b>
        </Link>

        <div className="row" style={{ gap: 8 }}>
          <button
            className={`btn grow ${mode === "create" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMode("create")}
          >
            {no.host.createTitle}
          </button>
          <button
            className={`btn grow ${mode === "open" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMode("open")}
          >
            {no.host.enterTitle}
          </button>
        </div>

        {mode === "create" ? (
          <Wizard />
        ) : (
          <>
            <div className="field">
              <label htmlFor="hc">{no.host.hostCodeLabel}</label>
              <input
                id="hc"
                className="input"
                placeholder="f.eks. ABCD-7F"
                value={hostCode}
                onChange={(e) => setHostCode(e.target.value)}
                autoCapitalize="characters"
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy}
              onClick={open}
            >
              {busy ? <span className="spin" /> : no.host.open}
            </button>
            {error && <div className="banner banner-error">{error}</div>}
          </>
        )}
      </div>
    </main>
  );
}
