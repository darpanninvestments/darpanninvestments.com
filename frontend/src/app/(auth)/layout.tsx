import Image from "next/image";
import { CalendarClock, FileCheck2, Fingerprint, MapPin, ScrollText, ShieldCheck, UserPlus } from "lucide-react";

const FEATURES = [
  { icon: UserPlus, title: "Lead Board", text: "Enquiries from Meta, Google, website & WhatsApp – act on each in one click." },
  { icon: CalendarClock, title: "Follow-up command center", text: "Overdue, due-now and upcoming follow-ups with reminders and escalation." },
  { icon: MapPin, title: "Site visits & meetings", text: "Schedule, remind and record outcomes – offline or online." },
  { icon: FileCheck2, title: "Booking to onboarding", text: "Convert to client, share project documents and collect KYC securely." },
];

const TRUST = [
  { icon: Fingerprint, text: "Passwordless one-time codes" },
  { icon: ShieldCheck, text: "Role-based access" },
  { icon: ScrollText, text: "Full audit trail" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-[#f5f7fb] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* ── Brand panel (laptop and up) ── */}
      <aside className="relative hidden overflow-hidden bg-[#0b1430] text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "48px 48px" }} />
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-amber-400/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-blue-500/15 blur-3xl" />
        <Image aria-hidden src="/logo-mark.png" alt="" width={292} height={390} className="pointer-events-none absolute -bottom-10 right-6 h-[70%] w-auto opacity-[0.06]" />

        <div className="relative flex h-dvh flex-col px-12 py-8 xl:px-16 [@media(min-height:900px)]:py-12">
          <Image src="/logo.png" alt="Darpann Investments – Reflecting your dreams" width={1280} height={398} priority className="h-auto w-56 xl:w-64" />

          <div className="my-auto max-w-xl py-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />Real Estate CRM Portal
            </span>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-tight xl:text-[38px] [@media(min-height:900px)]:xl:text-[44px]">
              Every lead, visit and booking —{" "}
              <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500 bg-clip-text text-transparent">one connected workspace.</span>
            </h1>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-slate-300">
              Capture enquiries from every channel, follow up on time and take each buyer from first call to client onboarding — without re-typing a thing.
            </p>

            <div className="mt-7 grid grid-cols-2 gap-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition hover:border-amber-300/30 hover:bg-white/[0.07]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-300/15 text-amber-300"><Icon className="h-[18px] w-[18px]" /></span>
                  <p className="mt-2.5 text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 hidden text-xs leading-relaxed text-slate-400 xl:block [@media(max-height:760px)]:hidden">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-xs text-slate-400">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {TRUST.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-amber-300/80" />{text}</li>
              ))}
            </ul>
            <span>© {new Date().getFullYear()} Darpann Investments</span>
          </div>
        </div>
      </aside>

      {/* ── Sign-in panel ── */}
      <main className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-center bg-[#0b1430] px-5 py-4 lg:hidden">
          <Image src="/logo.png" alt="Darpann Investments" width={1280} height={398} priority className="h-auto w-48 sm:w-56" />
        </header>
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">{children}</div>
        <p className="pb-6 text-center text-xs text-slate-400 lg:hidden">© {new Date().getFullYear()} Darpann Investments</p>
      </main>
    </div>
  );
}
