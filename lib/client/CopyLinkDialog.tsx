"use client";

import { useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { Modal } from "@/lib/client/Modal";

/** Themed fallback for when navigator.clipboard is unavailable (replaces
 * window.prompt): the link is shown selected in a read-only field with a copy
 * button, so it can still be copied by hand on any device. */
export function CopyLinkDialog({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <Modal open onClose={onClose} title={title} size="sm" initialFocusRef={input}>
      <input
        ref={input}
        className="input"
        readOnly
        value={url}
        aria-label={title}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="row" style={{ justifyContent: "center" }}>
        <button type="button" className="btn btn-primary" onClick={copy}>
          {copied ? no.common.copied : no.common.copy}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {no.common.close}
        </button>
      </div>
    </Modal>
  );
}
