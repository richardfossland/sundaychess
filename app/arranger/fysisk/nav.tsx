"use client";

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const EVT = "physical:navigate";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVT, cb);
  };
}

/** Gjeldende sti, lest fra adressefeltet på klienten ("" under server-rendering). */
export function useClientPath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "");
}

/** Navigasjon uten Next-ruter (ingen RSC-henting) – virker uten nett. */
export function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVT));
}

export function NavLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
