import type { BoardState } from "@/lib/dto";
import { teamColor } from "@/lib/tournament/teams";
import { no } from "@/lib/locale/no";

/** Stillingstabell med forklaring av Buchholz rett under — brukt i runde-,
 * sluttspill- og resultatvisning, så ingen tabell står uten forklaring. */
export function StandingsTable({
  standings,
  teamById,
  limit,
}: {
  standings: BoardState["standings"];
  teamById: (id: string) => string | null;
  /** Vis høyst så mange rader, resten som «+N til». */
  limit?: number;
}) {
  const rows = limit && standings.length > limit ? standings.slice(0, limit) : standings;
  const rest = standings.length - rows.length;
  return (
    <>
      <table className="table table-compact">
        <thead>
          <tr>
            <th scope="col" title={no.host.rankHelp}>{no.host.rank}</th>
            <th scope="col">{no.host.name}</th>
            <th scope="col" className="num" title={no.host.scoreHelp}>
              {no.host.score}
            </th>
            <th scope="col" className="num" title={no.host.tiebreakHelp}>
              {no.host.tiebreak}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const team = teamById(s.playerId);
            return (
              <tr key={s.playerId}>
                <td>
                  <span className={`rankpill ${s.rank <= 3 ? "r" + s.rank : ""}`}>{s.rank}</span>
                </td>
                <td>
                  {s.displayName}
                  {team && (
                    <span
                      className="team-dot team-dot-inline"
                      title={team}
                      style={{ background: teamColor(team) }}
                    />
                  )}
                </td>
                <td className="num">
                  <b>{s.score}</b>
                </td>
                <td className="num muted">{s.tiebreak}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rest > 0 && <p className="tiebreak-note">+{rest} {no.host.moreRows}</p>}
      <p className="tiebreak-note">
        <b>{no.host.tiebreak}</b>: {no.host.tiebreakHelp}
      </p>
    </>
  );
}
