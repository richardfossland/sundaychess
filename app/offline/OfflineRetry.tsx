"use client";

export function OfflineRetry({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-primary btn-lg" onClick={() => location.reload()}>
      {label}
    </button>
  );
}
