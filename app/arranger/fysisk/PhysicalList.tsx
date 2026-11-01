"use client";

import { NavLink } from "./nav";
import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { PageHeader } from "@/lib/client/PageHeader";
import { deleteTournament, listTournaments, type StorageKind } from "@/lib/physical/storage";
import type { StoredTournament } from "@/lib/physical/schema";
import { ImportFile } from "./ImportFile";
import { OpenPublished } from "./cloud/OpenPublished";
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
        <PageHeader backHref="/arranger" />
        <div className="card-head">
          <p className="eyebrow">{t.pageTitle}</p>
          <p className="muted fs-xs">{t.pageIntro}</p>
        </div>
        {kind === "memory" && <div className="banner banner-error">{t.storageMemoryWarn}</div>}
        {kind === "localStorage" && (
          <div className="muted text-center fs-xs">
            {t.storageLocalWarn}
          </div>
        )}

        <NavLink href="/arranger/fysisk/ny" className="btn btn-primary btn-block btn-lg">
          <Icon name="more" size={16} /> {t.newTournament}
        </NavLink>

        <ImportFile />
        <OpenPublished />

        {items && items.length === 0 && <p className="muted text-center">{t.emptyList}</p>}
        <div className="stack gap-2">
          {items?.map((it) => (
            <div key={it.id} className="spread gap-2">
              <NavLink href={`/arranger/fysisk/${it.id}`} className="grow" style={{ textDecoration: "none" }}>
                <b>{it.title}</b>
                <span className="muted fs-xs" style={{ display: "block" }}>
                  {t.summary(it.playerCount, it.roundsPlayed)}
                </span>
              </NavLink>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(it)}>
                {t.remove}
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
