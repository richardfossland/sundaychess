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
      <div className="card card-form stack scale-in">
        <PageHeader backHref="/arranger" />
        <div className="card-head">
          <p className="eyebrow">{t.pageTitle}</p>
          <div className="tags tags-center"><span className="tag"><Icon name="lock" size={12} /> {t.pageIntro}</span></div>
        </div>
        {kind === "memory" && <div className="banner banner-error">{t.storageMemoryWarn}</div>}
        {kind === "localStorage" && <div className="tags tags-center"><span className="tag tag-warn"><Icon name="warn" size={12} /> {t.storageLocalWarn}</span></div>}

        <NavLink href="/arranger/fysisk/ny" className="btn btn-primary btn-block btn-lg">
          <Icon name="more" size={16} /> {t.newTournament}
        </NavLink>

        <section className="sect" aria-label={t.openExisting}>
          <h2 className="sect-title">{t.openExisting}</h2>
          <ImportFile />
          <OpenPublished />
        </section>

        <section className="sect" aria-label={t.listTitle}>
          <h2 className="sect-title">{t.listTitle}</h2>
          {items && items.length === 0 && <p className="muted fs-xs m-0">{t.emptyList}</p>}
          <ul className="pl-list">
            {items?.map((it) => (
              <li key={it.id} className="pl-item">
                <NavLink href={`/arranger/fysisk/${it.id}`} className="pl-link no-underline">
                  <b>{it.title}</b>
                  <span className="muted fs-xs block">{t.summary(it.playerCount, it.roundsPlayed)}</span>
                </NavLink>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(it)}>
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
