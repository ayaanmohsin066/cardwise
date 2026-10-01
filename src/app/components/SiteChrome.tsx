import Link from "next/link";

/** Shared page width and side gutters for the header, main content and footer. */
export const SHELL = "mx-auto w-full max-w-6xl px-4 sm:px-6";

function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
      <div className={`${SHELL} flex h-14 items-center justify-between gap-4`}>
        <Link href="/" className="flex items-center gap-2.5 rounded-md" aria-label="CardOpt home">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.75" />
              <path d="M1.75 6.75h12.5M4.5 10h2.5" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight">CardOpt</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="tag">Canada · CAD</span>
          <span className="tag hidden sm:inline-flex">
            <LockIcon />
            Processed in your browser
          </span>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className={`${SHELL} flex flex-col gap-1 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between`}>
        <p>For information only, not financial advice. Your issuer&apos;s own terms decide what you earn.</p>
        <p>A redesign of the original CardOpt by @srinihal007.</p>
      </div>
    </footer>
  );
}
