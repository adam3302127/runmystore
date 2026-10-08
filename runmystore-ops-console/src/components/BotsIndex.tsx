"use client";
import { createContext, useContext } from "react";
import type { Bot } from "@/lib/types";

const Ctx = createContext<Bot[]>([]);
/** All bots the viewer can see, loaded once by the console layout for lookups, filters and the palette. */
export function BotsIndexProvider({ bots, children }: { bots: Bot[]; children: React.ReactNode }) {
  return <Ctx.Provider value={bots}>{children}</Ctx.Provider>;
}
export function useBotsIndex() { return useContext(Ctx); }
