"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { no } from "@/lib/locale/no";
import { createAuthBrowserClient } from "@/lib/supabase/auth-browser";
import type { TournamentStatus } from "@/lib/types";

interface Item {
  id: string;
  title: string | null;
  status: TournamentStatus;
  joinPin: string;
  createdAt: string;
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  lobby: no.hostAuth.statusLobby,
  league: no.hostAuth.statusLeague,
  playoff: no.hostAuth.statusPlayoff,
  finished: no.hostAuth.statusFinished,
};

export function HostDashboard({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initial);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doDelete(id: string) {
    setConfirmId(null);
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/host/tournaments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setItems((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError(no.hostAuth.deleteError);
    } finally {
      setDeletingId(null);
    }
  }

  async function signOut() {
    const supabase = createAuthBrowserClient();
    await supabase.auth.signOut();
    router.push("/host/login");
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 14, width: "100%" }}>
      <p className="muted text-center" style={{ fontSize: 13 }}>
        {no.hostAuth.dashLede}
      </p>

      <div className="row" style={{ justifyContent: "center", gap: 10 }}>
        <Link href="/arranger" className="btn btn-primary">
          + {no.hostAuth.createNew}
        </Link>
        <button className="btn btn-ghost" onClick={signOut}>
          {no.hostAuth.signOut}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {items.length === 0 ? (
        <div className="banner" style={{ textAlign: "center" }}>
          {no.hostAuth.empty}
        </div>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((t) => (
            <li
              key={t.id}
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 16px",
              }}
            >
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 16 }}>{t.title || no.hostAuth.untitled}</b>
                <span className="faint" style={{ fontSize: 12 }}>
                  {STATUS_LABEL[t.status]} · PIN {t.joinPin} ·{" "}
                  {no.hostAuth.created} {new Date(t.createdAt).toLocaleDateString("no")}
                </span>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <Link href={`/host/${t.id}`} className="btn btn-sm">
                  {no.hostAuth.manage}
                </Link>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={deletingId === t.id}
                  onClick={() => setConfirmId(t.id)}
                >
                  {deletingId === t.id ? no.hostAuth.deleting : no.hostAuth.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmId && (
        <ConfirmDialog
          message={no.hostAuth.deleteConfirm}
          confirmLabel={no.hostAuth.delete}
          danger
          onConfirm={() => doDelete(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}
