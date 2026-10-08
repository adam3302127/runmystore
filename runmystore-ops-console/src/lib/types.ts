import type { Channel, EventStatus, EventType, Lane } from "@/lib/event-contract";

export type Client = {
  id: string; slug: string; name: string; plan: string | null;
  status: "onboarding" | "active" | "paused" | "churned"; timezone: string; close_lead_id: string | null;
  store_message_bodies: boolean; accent_color: string | null; is_demo: boolean; created_at: string;
};
export type Bot = {
  id: string; client_id: string; slug: string; name: string; lane: Lane; platform: string | null; description: string | null;
  expected_interval_minutes: number; enabled: boolean; last_seen_at: string | null; last_event_at: string | null;
  last_error_at: string | null; last_summary: string | null; open_decisions: number; created_at: string;
};
export type EventLink = { label: string; url: string };
export type Event = {
  id: string; bot_id: string; client_id: string; run_id: string | null; type: EventType; status: EventStatus; severity: number;
  summary: string; detail: string | null; channel: Channel | null; direction: "inbound" | "outbound" | "none";
  counterparty_name: string | null; counterparty_handle: string | null; thread_ref: string | null;
  close_lead_id: string | null; close_activity_id: string | null; amount_cents: number | null;
  links: EventLink[]; payload: Record<string, unknown>; idempotency_key: string | null; occurred_at: string; received_at: string;
};
export type DecisionOption = { key: string; label: string };
export type Decision = {
  id: string; event_id: string; bot_id: string; client_id: string; question: string; context: string | null;
  options: DecisionOption[]; priority: number; due_at: string | null; state: "open" | "answered" | "dismissed" | "expired";
  answer_key: string | null; answer_note: string | null; answered_by: string | null; answered_at: string | null;
  delivered_to_bot_at: string | null; created_at: string;
};
export type TeamMember = { user_id: string; display_name: string; role: "owner" | "admin" | "operator" | "viewer"; all_clients: boolean; created_at: string };
export type ClientAccess = { user_id: string; client_id: string };
export type EventNote = { id: string; event_id: string; client_id: string; user_id: string; body: string; created_at: string };
export type BotKey = { id: string; bot_id: string; prefix: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type ClientStats = {
  client_id: string; events: number; answered: number; brought_back: number; leads_delivered: number; orders: number;
  errors: number; decisions_opened: number; messages_in: number; messages_out: number;
};
export type BotRun = {
  run_id: string; started_at: string; ended_at: string; events: number; messages: number; crm_writes: number;
  errors: number; decisions: number; finished: boolean;
};
export type Viewer = { user: { id: string; email: string | null }; member: TeamMember; isAdmin: boolean; canAct: boolean };

export const LANE_LABEL: Record<Lane, string> = { cs: "Customer Service", retention: "Retention", lead: "Lead Engine", ops: "Ops", other: "Other" };
export const LANE_SHORT: Record<Lane, string> = { cs: "CS", retention: "Retention", lead: "Lead", ops: "Ops", other: "Other" };
export const TYPE_LABEL: Record<EventType, string> = {
  action: "Action", message_sent: "Message sent", message_received: "Message received", crm_write: "CRM write", alert: "Alert",
  error: "Error", decision_needed: "Needs you", run_started: "Run started", run_finished: "Run finished", heartbeat: "Heartbeat",
};
export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email", whatsapp: "WhatsApp", sms: "SMS", chat: "Chat", crm: "CRM", web: "Web", phone: "Phone", internal: "Internal", other: "Other",
};
export const PLAN_LABEL: Record<string, string> = {
  cs: "Customer Service", retention: "Retention", lead: "Lead Engine", run_the_store: "Run the store", custom: "Custom", internal: "Internal",
};
