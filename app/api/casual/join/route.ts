import { joinCasualGame } from "@/lib/server/casual";
import { fail, ok, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";
import { isValidPin } from "@/lib/codes";
import { isGuessBlocked, registerGuessFailure, withDeviceCookie } from "@/lib/server/deviceGuard";

// POST /api/casual/join — join a casual 1v1 by code as the second player; the
// game auto-starts and the gameId is returned.
// M1: feil PIN telles per enhet + IP (samme maskineri og scope `pin` som /api/join:
// PIN-rommet er delt). Cookie-stien MÅ være ruten selv, ellers sender nettleseren
// aldri `sc_dev` tilbake og hver forespørsel ser ut som en ny enhet.
export const POST = withApi((req: Request) =>
  withDeviceCookie(req, "/api/casual/join", (device) => handlePost(req, device)),
);

async function handlePost(req: Request, device: string): Promise<Response> {
  if (!rateLimit(`casualjoin:${clientIp(req)}`, 60, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ pin?: string; name?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  const name = (body?.name ?? "").toString().trim();
  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  if (name.length < 1) return fail(400, "missing_name");

  if (await isGuessBlocked("pin", device, req)) return fail(429, "rate_limited");

  const res = await joinCasualGame(pin, name.slice(0, 40));
  if (!res.ok) {
    // Bare en PIN som ikke finnes er en feilgjetting; «full»/«ikke casual» betyr
    // at PIN-en var riktig og telles aldri.
    if (res.reason === "not_found" && (await registerGuessFailure("pin", device, req))) {
      return fail(429, "rate_limited");
    }
    const map = {
      not_found: [404, "invalid_pin"],
      not_casual: [409, "not_casual"],
      full: [409, "full"],
    } as const;
    const [status, code] = map[res.reason];
    return fail(status, code);
  }
  return ok(res);
}
