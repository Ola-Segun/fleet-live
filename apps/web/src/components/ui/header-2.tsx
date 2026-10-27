"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { siteNavigation } from "@/components/ui/site-navigation";

function WordmarkIcon() {
  return (
    <svg viewBox="0 0 22 22" className="size-6" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="9" stroke="currentColor" strokeOpacity=".35" />
      <circle cx="11" cy="11" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="inline-flex shrink-0 items-center gap-2.5 text-white" aria-label="Fleet Live home">
      <span className="grid size-9 place-items-center text-brand-lime">
        <WordmarkIcon />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.04em] text-white">
        Fleet<span className="text-brand-lime">Live</span>
      </span>
    </Link>
  );
}

function DemoLink({ mobile = false }: { mobile?: boolean }) {
  return (
    <Link
      href="/app"
      className={
        mobile
          ? "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/25 bg-[linear-gradient(180deg,#d9f59b_0%,#c8ed73_48%,#a8d451_100%)] px-4 text-sm font-semibold text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-2px_0_rgba(0,0,0,0.18),0_10px_24px_-8px_rgba(200,237,115,0.35),0_2px_4px_rgba(0,0,0,0.4)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-lime"
          : "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-black/25 bg-[linear-gradient(180deg,#d9f59b_0%,#c8ed73_48%,#a8d451_100%)] px-4 text-sm font-semibold text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-2px_0_rgba(0,0,0,0.18),0_10px_24px_-8px_rgba(200,237,115,0.35),0_2px_4px_rgba(0,0,0,0.4)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-lime"
      }
    >
      Open interactive demo <span aria-hidden="true">↗</span>
    </Link>
  );
}

function NavigationLinks({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {siteNavigation.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={
              mobile
                ? `rounded-lg px-3 py-3 text-sm transition focus-visible:outline-2 focus-visible:outline-brand-lime ${
                    active ? "bg-white/10 font-medium text-white" : "text-slate-200 hover:bg-white/5 hover:text-white"
                  }`
                : `rounded-md px-3 py-2 text-[13px] transition focus-visible:outline-2 focus-visible:outline-brand-lime ${
                    active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function Header() {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const open = openPath === pathname;

  useEffect(() => {
    const updateScrollState = () => setScrolled(window.scrollY > 10);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPath(null);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <header
        data-scrolled={scrolled}
        className={`sticky z-50 mx-auto w-full px-3 pt-3 transition-[max-width,top] duration-200 ease-out ${
          scrolled
            ? "top-0 md:top-3 md:max-w-5xl"
            : "top-0 max-w-[90rem]"
        }`}
      >
        <nav
          className={`mx-auto flex h-[68px] w-full items-center justify-between gap-3 rounded-2xl border px-3 backdrop-blur-[14px] backdrop-saturate-[1.2] transition-[background-color,border-color,box-shadow] duration-200 ease-out sm:px-4 md:h-14 md:px-[18px] ${
            scrolled
              ? "border-white/10 bg-brand-ink/95 shadow-lg shadow-black/20"
              : "border-white/10 bg-[linear-gradient(180deg,rgba(40,52,78,0.62),rgba(14,20,34,0.74))] shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_-1px_0_rgba(0,0,0,0.5),0_14px_34px_-12px_rgba(0,0,0,0.55),0_2px_6px_rgba(0,0,0,0.35)]"
          }`}
          aria-label="Main navigation"
        >
          <Brand />

          <div className={`hidden items-center gap-1 md:flex ${scrolled ? "md:gap-0" : "md:gap-1"}`}>
            <NavigationLinks />
            <DemoLink />
          </div>

          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/20 text-white transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-lime md:hidden"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            aria-controls="mobile-site-navigation"
            onClick={() => setOpenPath(open ? null : pathname)}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {open ? (
                <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </nav>
      </header>
      {open && createPortal(
        <div
          id="mobile-site-navigation"
          className="fixed inset-x-0 bottom-0 top-[80px] z-[60] flex min-h-0 flex-col overflow-y-auto border-t border-white/10 bg-brand-ink px-5 pb-8 pt-5 motion-reduce:scroll-auto md:hidden"
        >
          <nav className="grid gap-1" aria-label="Mobile navigation">
            <NavigationLinks mobile onNavigate={() => setOpenPath(null)} />
          </nav>
          <div className="mt-auto pt-8">
            <DemoLink mobile />
            <p className="mt-4 text-center text-xs leading-5 text-slate-400">
              Interactive portfolio demo · simulated fleet data
            </p>
          </div>
        </div>
      , document.body)}
    </>
  );
}
