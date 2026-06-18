import { redirect } from "next/navigation";

import { getHost } from "@/lib/server/auth";
import { listTournamentsByOwner } from "@/lib/server/store";
import { no } from "@/lib/locale/no";
import { HostDashboard } from "./HostDashboard";

// The signed-in host's "mine turneringer" dashboard. Middleware already
// redirects anonymous visitors to /host/login; this also guards server-side
// (defence in depth + handles the allow-list 403: a signed-in but non-admin
// Sunday Account is bounced to login rather than shown the dashboard).
export default async function HostDashboardPage() {
  const host = await getHost();
  if (!host) redirect("/host/login");

  const rows = await listTournamentsByOwner(host.id);
  const items = rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    joinPin: t.join_pin,
    createdAt: t.created_at,
  }));

  return (
    <main className="center-screen">
      <div className="card stack scale-in" style={{ maxWidth: 640, width: "100%" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <p className="eyebrow text-center">{no.hostAuth.dashTitle}</p>
        <p className="muted text-center" style={{ fontSize: 14 }}>
          {no.hostAuth.signedInAs} <b>{host.email}</b>
        </p>
        <HostDashboard initial={items} />
      </div>
    </main>
  );
}
