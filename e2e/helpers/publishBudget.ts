// Publisering og «Fortsett digitalt» deler et dagsbudsjett per IP (MAX_PUBLISHES_PER_DAY), lagret
// i code_attempts. I nattkjøringen deler flere Playwright-prosjekter både IP og database, så
// budsjettet tømmes uten at noe er galt: en test får da «For mange forsøk». Hver test starter derfor
// med fullt budsjett. Selve grensen er uendret og har sin egen enhetstest.
//
// Bare mot en lokal Supabase: `.env.local` i dette repoet kan peke mot produksjon.
export async function resetPublishBudget(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return;
  const res = await fetch(`${url}/rest/v1/code_attempts?scope=eq.publish`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Kunne ikke nullstille publiseringsbudsjettet: ${res.status}`);
}
