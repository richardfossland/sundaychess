"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Promise-based stand-in for window.confirm, rendered with the themed
 * ConfirmDialog. Usage:
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm("Sikker?"))) return;
 *   ... render {confirmDialog} somewhere in the component tree.
 * A second confirm() while one is open cancels the first (resolves false).
 * Unmounting resolves a pending one as false.
 */
export function useConfirm(): [(message: string, opts?: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [req, setReq] = useState<{ message: string; opts: ConfirmOptions } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  }, []);

  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const confirm = useCallback((message: string, opts: ConfirmOptions = {}) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setReq({ message, opts });
    });
  }, []);

  const dialog = req ? (
    <ConfirmDialog
      message={req.message}
      confirmLabel={req.opts.confirmLabel}
      cancelLabel={req.opts.cancelLabel}
      danger={req.opts.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return [confirm, dialog];
}
