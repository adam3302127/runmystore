"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Stripes } from "@/components/Stripes";
import { ConnectionPill } from "@/components/ConnectionPill";
import { ClientSwitcher, useScopedHref } from "@/components/ClientScope";
import { CommandPalette } from "@/components/CommandPalette";
import type { Viewer } from "@/lib/types";

const NAV = [
  { href: "/", label: "Fleet" }, { href: "/feed", label: "Timeline" }, { href: "/inbox", label: "Inbox" },
  { href: "/decisions", label: "Needs you" }, { href: "/clients", label: "Clients" }, { href: "/search", label: "Search" },
];

export function TopBar({ viewer, fleet }: { viewer: Viewer; fleet: { live: number; total: number } }) {
  const pathname = usePathname();
  const scoped = useScopedHref();
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const items = viewer.isAdmin ? [...NAV, { href: "/settings", label: "Settings" }] : NAV;
  return (
    <header className="topbar">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link href={scoped("/")} className="wordmark" aria-label="RMS Ops Console home"><span>RMS</span><Stripes /></Link>
        <nav className="nav hidden items-center gap-1 lg:flex" aria-label="Primary">
          {items.map((n) => (
            <Link key={n.href} href={scoped(n.href)} aria-current={(n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)) ? "page" : undefined}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className="pill sm hidden sm:inline-flex" onClick={() => setOpen(true)} title="Search anything (Command K)">
            Search <kbd aria-hidden="true">⌘K</kbd>
          </button>
          <ClientSwitcher />
          <span className="hidden sm:inline-flex"><ConnectionPill detail={`${fleet.live}/${fleet.total} bots`} /></span>
          <div className="relative">
            <button type="button" className="pill sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {viewer.member.display_name.split(" ")[0]} <span className="text-dim">· {viewer.member.role}</span>
            </button>
            {menu && (
              <div role="menu" className="card absolute right-0 mt-2 w-56 p-2 text-sm" style={{ zIndex: 50 }}>
                <p className="px-2 py-1 text-dim text-xs truncate">{viewer.user.email}</p>
                <nav className="nav grid lg:hidden" aria-label="Primary (small screens)">
                  {items.map((n) => <Link key={n.href} href={scoped(n.href)} onClick={() => setMenu(false)}>{n.label}</Link>)}
                </nav>
                <form action="/auth/signout" method="post"><button role="menuitem" type="submit" className="nav w-full text-left px-2 py-2 rounded-lg hover:bg-white/10 font-semibold">Sign out</button></form>
              </div>
            )}
          </div>
        </div>
      </div>
      <CommandPalette open={open} onClose={() => setOpen(false)} onOpen={() => setOpen(true)} />
    </header>
  );
}
