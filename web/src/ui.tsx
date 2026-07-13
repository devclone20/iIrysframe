import { useEffect, useState, type ReactNode } from "react";

// ── Toasts (external store) ──────────────────────────────────────────────────
type Kind = "" | "ok" | "err";
interface ToastItem {
  id: number;
  msg: string;
  kind: Kind;
}
let toasts: ToastItem[] = [];
const toastSubs = new Set<() => void>();
let toastSeq = 0;

export function toast(msg: string, kind: Kind = ""): void {
  const id = ++toastSeq;
  toasts = [...toasts, { id, msg, kind }];
  toastSubs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastSubs.forEach((s) => s());
  }, 3600);
}

export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    toastSubs.add(s);
    return () => {
      toastSubs.delete(s);
    };
  }, []);
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-show ${t.kind === "ok" ? "is-ok" : t.kind === "err" ? "is-err" : ""}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── Confirm dialog (promise-based, external store) ───────────────────────────
interface ConfirmReq {
  title: string;
  body: string;
  ok: string;
  resolve: (v: boolean) => void;
}
let confirmReq: ConfirmReq | null = null;
const confirmSubs = new Set<() => void>();

export function confirmDialog(title: string, body: string, ok = "Confirm"): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq = { title, body, ok, resolve };
    confirmSubs.forEach((s) => s());
  });
}

export function ConfirmHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    confirmSubs.add(s);
    return () => {
      confirmSubs.delete(s);
    };
  }, []);
  if (!confirmReq) return null;
  const req = confirmReq;
  const done = (v: boolean) => {
    req.resolve(v);
    confirmReq = null;
    confirmSubs.forEach((s) => s());
  };
  return (
    <Modal onClose={() => done(false)}>
      <h3>{req.title}</h3>
      <p className="modal__sub" dangerouslySetInnerHTML={{ __html: req.body }} />
      <div className="modal__actions">
        <button className="btn btn--ghost" onClick={() => done(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={() => done(true)}>
          {req.ok}
        </button>
      </div>
    </Modal>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────
export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal is-open">
      <div className="modal__scrim" onClick={onClose} />
      <div className="modal__card">{children}</div>
    </div>
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className={`drawer ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="drawer__scrim" onClick={onClose} />
      <div className="drawer__panel">{open && children}</div>
    </div>
  );
}

export async function copy(text: string, label = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, "ok");
  } catch {
    toast("Copy failed", "err");
  }
}

export function CopyField({ value }: { value: string }) {
  return (
    <div className="copyfield">
      <code>{value}</code>
      <button onClick={() => copy(value)}>Copy</button>
    </div>
  );
}

export const errMsg = (e: any): string => (e?.message ?? String(e)).slice(0, 180);
