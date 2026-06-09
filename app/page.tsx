import { redirect } from "next/navigation";

// Students who open the site go straight to the PIN entry — no teacher choice.
// Teachers use /host directly.
export default function Home() {
  redirect("/play");
}
