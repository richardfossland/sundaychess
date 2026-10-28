"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { deleteTournament, listTournaments, type StorageKind } from "@/lib/physical/storage";
import type { StoredTournament } from "@/lib/physical/schema";
import { getStore } from "./usePhysical";

export function PhysicalList() {
  const [items, setItems] = useState<StoredTournament[] | null>(null);
  const [kind, setKind] = useState<StorageKind | null>(null);
  const t = no.physical;

  async function refresh() {
    const store = await getStore();
    setKind(store.kind);
    setItems(await listTournaments(store));
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await getStore();
      const list = await listTournaments(store);
      if (!alive) return;
      setKind(store.kind);
      setItems(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function remove(it: StoredTournament) {
    if (!window.confirm(t.removeConfirm(it.title))) return;
    await deleteTournament(await getStore(), it.id);
    await refresh();
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in">
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <p className="eyebrow text-center">{t.pageTitle}</p>
        <p className="muted text-center" style={{ fontSize: 13 }}>
          {t.pageIntro}
        </p>
        {kind === "memory" && <div className="banner banner-error">{t.storageMemoryWarn}</div>}
        {kind === "localStorage" && (
          <div className="muted text-center" style={{ fontSize: 12 }}>
            {t.storageLocalWarn}
          </div>
        )}

        <Link href="/arranger/fysisk/ny" className="btn btn-primary btn-block btn-lg">
          <Icon name="more" size={16} /> {t.newTournament}
        </Link>

        {items && items.length === 0 && <p className="muted text-center">{t.emptyList}</p>}
        <div className="stack" style={{ gap: 8 }}>
          {items?.map((it) => (
            <div key={it.id} className="spread" style={{ gap: 8 }}>
              <Link href={`/arranger/fysisk/${it.id}`} className="grow" style={{ textDecoration: "none" }}>
                <b>{it.title}</b>
                <span className="muted" style={{ display: "block", fontSize: 12 }}>
                  {t.summary(it.playerCount, it.roundsPlayed)}
                </span>
              </Link>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(it)}>
                {t.remove}
              </button>
            </div>
          ))}
        </div>

        <Link href="/arranger" className="btn btn-ghost btn-block">
          <Icon name="back" size={16} /> {no.common.back}
        </Link>
      </div>
    </main>
  );
}
