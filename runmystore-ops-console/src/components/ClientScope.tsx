"use client";
import { createContext, useContext } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Client } from "@/lib/types";

const Ctx = createContext<{ clients: Client[]; current: Client | null }>({ clients: [], current: null });
export function ClientScopeProvider({ clients, children }: { clients: Client[]; children: React.ReactNode }) {
  const params = useSearchParams();
  const slug = params.get("client");
  const current = clients.find((c) => c.slug === slug) ?? null;
  return <Ctx.Provider value={{ clients, current }}>{children}</Ctx.Provider>;
}
export function useClientScope() { return useContext(Ctx); }

/** Appends the selected client to an internal href so the scope survives navigation. */
export function useScopedHref() {
  const { current } = useClientScope();
  return (href: string) => {
    if (!current) return href;
    const [path, q] = href.split("?");
    const sp = new URLSearchParams(q ?? "");
    sp.set("client", current.slug);
    return `${path}?${sp.toString()}`;
  };
}

export function ClientSwitcher() {
  const { clients, current } = useClientScope();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (clients.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Client</span>
      <select
        className="select pill sm pr-8"
        style={{ width: "auto", background: "var(--ink-2)" }}
        value={current?.slug ?? ""}
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          if (e.target.value) sp.set("client", e.target.value); else sp.delete("client");
          sp.delete("cursor");
          router.push(`${pathname}${sp.size ? `?${sp}` : ""}`);
        }}
      >
        <option value="">All clients</option>
        {clients.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
      </select>
    </label>
  );
}
