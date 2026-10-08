"use client";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import type { Event } from "@/lib/types";
import { tagClass, toRow } from "@/lib/feed-mapping";
import type { Lane } from "@/lib/event-contract";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function FeedRow({ event, bot, fresh, onOpen, showTime }: {
  event: Event; bot?: { name: string; lane: Lane }; fresh?: boolean; onOpen?: (e: Event) => void; showTime?: React.ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const animated = useRef(false);
  useLayoutEffect(() => {
    if (!fresh || animated.current || !ref.current || reducedMotion()) return;
    animated.current = true;
    gsap.from(ref.current, { y: -16, opacity: 0, duration: 0.55, ease: "back.out(1.6)" });
  }, [fresh]);
  const r = toRow(event, bot);
  const inner = (
    <>
      <span className="who">{r.who}</span>
      <span className="in" title={r.in}>{r.in}{showTime}</span>
      <span className="out">{r.out}</span>
      {r.tag && <span className={tagClass(r.tag)}>{r.tag.label}</span>}
    </>
  );
  const cls = `ev ${r.lane}${r.isError ? " is-error" : ""}`;
  return (
    <li ref={ref} data-event-id={event.id} data-fresh={fresh ? "1" : undefined} className={onOpen ? "list-none" : cls}>
      {onOpen ? <button type="button" className={`${cls} clickable`} onClick={() => onOpen(event)} aria-label={`Open: ${r.out}`}>{inner}</button> : inner}
    </li>
  );
}
