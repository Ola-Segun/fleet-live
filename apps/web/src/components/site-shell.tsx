import Link from "next/link";
import type { ReactNode } from "react";
import DitheredShaderBackground from "@/components/ui/dithered-shader-background-1";
import { Header } from "@/components/ui/header-2";
import { siteNavigation } from "@/components/ui/site-navigation";
import { FleetLiveFooter } from "@/components/ui/fleet-live-footer";
import { FleetUIProvider } from "@/components/ui/fleet-live-ui";

export { Brand } from "@/components/ui/header-2";

export function SiteFooter() {
  return (
    <FleetLiveFooter
      demoHref="/app"
      description="A real-time fleet-operations concept and engineering portfolio project. Explore with simulated data."
      columns={[
        {
          title: "Explore",
          links: siteNavigation.map(({ href, label }) => ({ href, label })),
        },
        {
          title: "Demo",
          links: [{ label: "Launch demo", href: "/app" }],
        },
      ]}
    />
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-paper text-brand-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-lime focus:px-4 focus:py-2 focus:text-brand-ink">
        Skip to content
      </a>
      <Header />
      <FleetUIProvider>{children}</FleetUIProvider>
      <SiteFooter />
    </div>
  );
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.19em] ${dark ? "text-brand-lime" : "text-brand-green"}`}>
      {children}
    </p>
  );
}

export function SiteHero({
  children,
  className = "",
  scale = 0.28,
  variant = "page",
}: {
  children: ReactNode;
  className?: string;
  scale?: number;
  variant?: "home" | "page";
}) {
  const spacing = variant === "home"
    ? "pb-16 pt-[calc(4rem+80px)] sm:pb-24 sm:pt-[calc(6rem+80px)] md:pt-[calc(6rem+68px)] lg:pb-28 lg:pt-[calc(7rem+68px)]"
    : "pb-16 pt-[calc(4rem+80px)] sm:pb-20 sm:pt-[calc(5rem+80px)] md:pt-[calc(5rem+68px)]";

  return (
    <section className="relative isolate -mt-[80px] min-h-[60svh] overflow-hidden bg-brand-ink text-white md:-mt-[68px]">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse 42% 60% at 90% 16%, rgba(74,116,83,.3), transparent), radial-gradient(ellipse 40% 45% at 7% 85%, rgba(38,84,110,.24), transparent)" }}
      />
      <DitheredShaderBackground scale={scale} />
      <div className={`relative z-10 mx-auto w-full max-w-[90rem] px-5 sm:px-6 ${spacing} ${className}`}>
        {children}
      </div>
    </section>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <SiteHero>
      <>
        <Eyebrow dark>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">{description}</p>
      </>
    </SiteHero>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  light = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  light?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={`mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl ${light ? "text-white" : "text-brand-ink"}`}>{title}</h2>
      {description && <p className={`mt-4 text-sm leading-7 sm:text-base ${light ? "text-slate-300" : "text-brand-muted"}`}>{description}</p>}
    </div>
  );
}

export function DemoPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1723] shadow-[0_28px_80px_-34px_rgba(7,19,30,.8)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-brand-lime shadow-[0_0_12px_#c8ed73]" />
          <span className="text-[10px] font-semibold tracking-[0.16em] text-slate-200 sm:text-xs">FLEET OVERVIEW</span>
        </div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[9px] font-semibold tracking-wider text-amber-200">
          SIMULATED DATA
        </span>
      </div>
      <div className="grid min-h-[300px] grid-cols-1 sm:grid-cols-[1fr_190px]">
        <div className="relative min-h-[270px] overflow-hidden bg-[#102131]">
          <div className="absolute inset-0 opacity-45" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.08) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
          <svg viewBox="0 0 640 360" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g fill="none" stroke="#365163" strokeWidth="13" strokeLinecap="round">
              <path d="M-25 76 120 126 209 91 302 143 419 96 670 148" />
              <path d="M-20 275 115 230 220 259 321 209 435 237 669 183" />
              <path d="m171-20 14 92-20 79 30 63-32 166" />
              <path d="m473-20-32 99 35 76-27 79 30 152" />
              <path d="M14 172 111 165 205 191 299 173 397 193 529 167 650 194" />
            </g>
            <g fill="none" stroke="#5a7884" strokeWidth="2" strokeDasharray="5 8" opacity=".8">
              <path d="M-25 76 120 126 209 91 302 143 419 96 670 148" />
              <path d="M-20 275 115 230 220 259 321 209 435 237 669 183" />
            </g>
            <path d="M56 253 130 223 220 248 307 202 375 214 435 178 546 154" fill="none" stroke="#c8ed73" strokeWidth="3" strokeDasharray="7 8" />
            <g fill="#c8ed73" stroke="#0b1723" strokeWidth="4">
              <circle cx="130" cy="223" r="7" /><circle cx="307" cy="202" r="7" /><circle cx="435" cy="178" r="7" /><circle cx="546" cy="154" r="7" />
            </g>
            <g fill="#60a5fa" stroke="#0b1723" strokeWidth="3">
              <circle cx="96" cy="134" r="5" /><circle cx="205" cy="190" r="5" /><circle cx="359" cy="144" r="5" />
              <circle cx="278" cy="258" r="5" /><circle cx="490" cy="226" r="5" /><circle cx="553" cy="166" r="5" />
              <circle cx="183" cy="95" r="5" /><circle cx="420" cy="98" r="5" /><circle cx="580" cy="187" r="5" />
              <circle cx="69" cy="267" r="5" /><circle cx="330" cy="211" r="5" /><circle cx="462" cy="244" r="5" />
            </g>
          </svg>
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-[#07131ecc] px-3 py-2 backdrop-blur">
            <p className="text-[9px] tracking-[0.16em] text-slate-400">SIMULATED FLEET</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">5,000 <span className="text-xs font-normal text-slate-400">vehicles</span></p>
          </div>
          <div className="absolute bottom-4 left-4 rounded-md border border-white/10 bg-[#07131ecc] px-2.5 py-1.5 text-[9px] tracking-wider text-slate-300 backdrop-blur">
            LAGOS, NIGERIA <span className="mx-1 text-slate-600">/</span> SEEDED DEMO
          </div>
        </div>
        <div className="hidden border-l border-white/10 bg-[#0d1b28] p-4 sm:block">
          <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-slate-300">
            <span>FLEET HEALTH</span><span className="text-brand-lime">DEMO</span>
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["Moving", "4,281", "bg-brand-lime"],
              ["Parked", "604", "bg-sky-400"],
              ["Attention", "18", "bg-rose-400"],
            ].map(([label, count, color]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs text-slate-300"><span className={`size-1.5 rounded-full ${color}`} />{label}</span>
                <span className="font-mono text-xs tabular-nums text-white">{count}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-slate-400">DEMO EVENT</p>
            <p className="mt-2 text-xs leading-5 text-slate-200">Zone entry detected</p>
            <p className="text-[10px] text-slate-500">Simulated vehicle · recent</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-2.5 text-[9px] tracking-wider text-slate-500 sm:px-5">
        <span>ILLUSTRATIVE PRODUCT PREVIEW</span><span>MAP · ALERTS · REPLAY</span>
      </div>
    </div>
  );
}

export function Callout({
  title,
  children,
  href = "/app",
  linkLabel = "Explore the interactive demo",
}: {
  title: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <aside className="flex flex-col justify-between gap-5 rounded-2xl border border-brand-green/15 bg-brand-tint p-6 sm:flex-row sm:items-center sm:p-8">
      <div>
        <h2 className="text-lg font-semibold text-brand-ink">{title}</h2>
        <div className="mt-1 text-sm leading-6 text-brand-muted">{children}</div>
      </div>
      <Link href={href} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-ink px-4 text-sm font-semibold text-white transition hover:bg-brand-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green">
        {linkLabel} <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}
