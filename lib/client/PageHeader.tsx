import Link from "next/link";
import { no } from "@/lib/locale/no";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  /** Tilbake som lenke (en egen side). */
  backHref?: string;
  /** Tilbake som handling (et steg inni samme side). Brukes om backHref mangler. */
  onBack?: () => void;
  /** Tilgjengelig navn på tilbake-knappen. */
  backLabel?: string;
}

/**
 * Felles toppfelt for inngangssidene: tilbake til venstre, varemerket (lenke
 * hjem) i midten, temabryter til høyre. Tre like brede spor, så varemerket står
 * midtstilt uansett om tilbake finnes. Tilbake er et ikon (44 px) med navn for
 * skjermlesere, så raden holder på 375 px.
 */
export function PageHeader({ backHref, onBack, backLabel = no.common.back }: Props) {
  return (
    <header className="page-header">
      <div className="page-header-side">
        {backHref ? (
          <Link href={backHref} className="page-header-btn" aria-label={backLabel} title={backLabel}>
            <Icon name="back" size={20} />
          </Link>
        ) : onBack ? (
          <button type="button" className="page-header-btn" onClick={onBack} aria-label={backLabel} title={backLabel}>
            <Icon name="back" size={20} />
          </button>
        ) : null}
      </div>
      <Link href="/" className="brandmark page-header-brand" aria-label={no.common.home}>
        <span className="knight">♞</span> Sunday<b>Chess</b>
      </Link>
      <div className="page-header-side page-header-side-end">
        <ThemeToggle inline />
      </div>
    </header>
  );
}
