"use client";

import { useId, useState } from "react";
import { Icon } from "@/lib/client/Icon";
import { Modal } from "@/lib/client/Modal";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { saveDigitalMeta } from "@/lib/physical/digitalMeta";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { continueRefusal } from "@/lib/physical/toDigital";

const L = no.continueDigital;

/** Sender loggen, lagrer arrangørkode/token som ved vanlig opprettelse, markerer den
 * lokale turneringen som «fortsatt digitalt» og returnerer id for arrangørvisningen. */
export async function continueDigitally(t: PhysicalTournament): Promise<string> {
  const refusal = continueRefusal(t);
  if (refusal) throw new Error(L.errors[refusal]);
  try {
    const r = await api.continueFromPhysical(t.events);
    identity.saveHostCode(r.id, r.hostCode);
    saveDigitalMeta(t.id, { digitalId: r.id, joinPin: r.joinPin });
    return r.id;
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "";
    throw new Error(L.errors[code] ?? L.errors.generic);
  }
}

/** «Fortsett digitalt»-knapp + bekreftelsesdialog i turneringshodet. */
export function ContinueDigital({ t }: { t: PhysicalTournament }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refusal = continueRefusal(t);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const id = await continueDigitally(t);
      window.location.assign(`/host/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : L.errors.generic);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" data-testid="continue-digital" onClick={() => setOpen(true)}>
        {L.menu}
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} labelledBy={titleId} size="md">
          <div className="stack">
            <h3 id={titleId} className="m-0">{L.title}</h3>
            {refusal ? (
              <div className="banner banner-error" role="alert" data-testid="continue-refusal">{L.errors[refusal]}</div>
            ) : (
              <>
                <p>{L.intro}</p>
                <div className="tags"><span className="tag"><Icon name="offline" size={12} /> {L.onlineNote}</span></div>
              </>
            )}
            {error && <div className="banner banner-error" role="alert">{error}</div>}
            <div className="row justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{L.cancel}</button>
              {!refusal && (
                <button type="button" className="btn btn-primary" disabled={busy} data-testid="continue-confirm" onClick={() => void go()}>
                  {busy ? L.working : L.confirm}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
