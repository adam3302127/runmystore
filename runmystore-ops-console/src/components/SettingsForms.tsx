"use client";
import { useState, useTransition } from "react";
import type { Bot, Client, TeamMember } from "@/lib/types";
import { PLAN_LABEL, LANE_LABEL } from "@/lib/types";
import { LANES } from "@/lib/event-contract";
import { inviteTeammate, removeTeammate, saveBot, saveClient, updateTeammate } from "@/app/actions";
import { Time } from "@/components/TimeZone";
import Link from "next/link";

type Action = (form: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
function useSubmit(action: Action, onDone?: () => void) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => { const r = await action(fd); if (!r.ok) setErr(r.error); else { setErr(null); onDone?.(); } });
  };
  return { err, pending, submit };
}
const Err = ({ msg }: { msg: string | null }) => (msg ? <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{msg}</p> : null);

export function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { err, pending, submit } = useSubmit(saveClient, onDone);
  const [bodies, setBodies] = useState(client?.store_message_bodies ?? false);
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="client-form">
      {client && <input type="hidden" name="id" value={client.id} />}
      <label className="field"><span className="label text-dim">Name</span><input className="input" name="name" required defaultValue={client?.name} /></label>
      <label className="field"><span className="label text-dim">Slug</span><input className="input" name="slug" required pattern="[a-z0-9-]+" defaultValue={client?.slug} placeholder="fresh-bros" /></label>
      <label className="field"><span className="label text-dim">Plan</span>
        <select className="select" name="plan" defaultValue={client?.plan ?? ""}><option value="">None</option>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span className="label text-dim">Status</span>
        <select className="select" name="status" defaultValue={client?.status ?? "active"}>{["onboarding", "active", "paused", "churned"].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="field"><span className="label text-dim">Time zone</span><input className="input" name="timezone" defaultValue={client?.timezone ?? "America/New_York"} /></label>
      <label className="field"><span className="label text-dim">Close lead id</span><input className="input" name="close_lead_id" defaultValue={client?.close_lead_id ?? ""} placeholder="lead_…" /></label>
      <label className="field"><span className="label text-dim">Accent color</span><input className="input" name="accent_color" defaultValue={client?.accent_color ?? ""} placeholder="#0d7377" /></label>
      <div className="grid gap-2 self-end">
        <label className="switch"><input type="checkbox" name="store_message_bodies" defaultChecked={client?.store_message_bodies} onChange={(e) => setBodies(e.target.checked)} /><span className="text-sm">Store full message bodies</span></label>
        <label className="switch"><input type="checkbox" name="is_demo" defaultChecked={client?.is_demo} /><span className="text-sm">Demo data (deleted by reset-demo)</span></label>
      </div>
      {bodies && <p className="sm:col-span-2 rounded-lg border border-amber/60 p-3 text-sm" style={{ borderColor: "rgba(180,83,9,.6)" }}>
        <strong>Heads up:</strong> with bodies on, the console keeps the full text of every message this client&apos;s bots send and receive. The homepage promises clients their conversations stay in accounts they own, so turn this on only with the client&apos;s written consent.
      </p>}
      <div className="sm:col-span-2 flex items-center gap-3"><button className="btn sm" type="submit" disabled={pending}>{client ? "Save client" : "Add client"}</button><button type="button" className="pill sm" onClick={onDone}>Cancel</button><Err msg={err} /></div>
    </form>
  );
}

export function BotForm({ bot, clients, onDone }: { bot?: Bot; clients: Client[]; onDone: () => void }) {
  const { err, pending, submit } = useSubmit(saveBot, onDone);
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="bot-form">
      {bot && <input type="hidden" name="id" value={bot.id} />}
      <label className="field"><span className="label text-dim">Client</span>
        <select className="select" name="client_id" required defaultValue={bot?.client_id ?? clients[0]?.id}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span className="label text-dim">Lane</span>
        <select className="select" name="lane" defaultValue={bot?.lane ?? "cs"}>{LANES.map((l) => <option key={l} value={l}>{LANE_LABEL[l]}</option>)}</select></label>
      <label className="field"><span className="label text-dim">Name</span><input className="input" name="name" required defaultValue={bot?.name} placeholder="Care Pack" /></label>
      <label className="field"><span className="label text-dim">Slug</span><input className="input" name="slug" required pattern="[a-z0-9-]+" defaultValue={bot?.slug} placeholder="care-pack" /></label>
      <label className="field"><span className="label text-dim">Expected interval (minutes)</span><input className="input" name="expected_interval_minutes" type="number" min={1} defaultValue={bot?.expected_interval_minutes ?? 60} /></label>
      <label className="field"><span className="label text-dim">Platform</span><input className="input" name="platform" defaultValue={bot?.platform ?? "assistant-platform"} /></label>
      <label className="field sm:col-span-2"><span className="label text-dim">What it does (shown on its page)</span><textarea className="textarea" name="description" rows={2} defaultValue={bot?.description ?? ""} /></label>
      <label className="switch"><input type="checkbox" name="enabled" defaultChecked={bot?.enabled ?? true} /><span className="text-sm">Enabled (a disabled bot&apos;s keys are refused)</span></label>
      <div className="sm:col-span-2 flex items-center gap-3"><button className="btn sm" type="submit" disabled={pending}>{bot ? "Save bot" : "Add bot"}</button><button type="button" className="pill sm" onClick={onDone}>Cancel</button><Err msg={err} /></div>
    </form>
  );
}

export function TeamForm({ member, email, clients, access, isOwner, onDone }: { member?: TeamMember; email?: string; clients: Client[]; access: string[]; isOwner: boolean; onDone: () => void }) {
  const { err, pending, submit } = useSubmit(member ? updateTeammate : inviteTeammate, onDone);
  const [all, setAll] = useState(member?.all_clients ?? false);
  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="team-form">
      {member && <input type="hidden" name="user_id" value={member.user_id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        {!member && <label className="field"><span className="label text-dim">Email</span><input className="input" type="email" name="email" required placeholder="teammate@runmystore.com" /></label>}
        <label className="field"><span className="label text-dim">Display name</span><input className="input" name="display_name" required defaultValue={member?.display_name} /></label>
        <label className="field"><span className="label text-dim">Role</span>
          <select className="select" name="role" defaultValue={member?.role ?? "operator"}>
            {isOwner && <option value="owner">Owner (everything)</option>}<option value="admin">Admin (everything)</option><option value="operator">Operator (acts on assigned clients)</option><option value="viewer">Viewer (read only)</option>
          </select></label>
      </div>
      {email && <p className="text-xs text-dim">{email}</p>}
      <label className="switch"><input type="checkbox" name="all_clients" defaultChecked={member?.all_clients} onChange={(e) => setAll(e.target.checked)} /><span className="text-sm">Can see all clients</span></label>
      {!all && (
        <fieldset className="grid gap-1.5 sm:grid-cols-2"><legend className="label text-dim mb-1">Assigned clients (operators and viewers)</legend>
          {clients.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="client_ids" value={c.id} defaultChecked={access.includes(c.id)} />{c.name}</label>)}
        </fieldset>
      )}
      <div className="flex items-center gap-3"><button className="btn sm" type="submit" disabled={pending}>{member ? "Save" : "Send invite"}</button><button type="button" className="pill sm" onClick={onDone}>Cancel</button><Err msg={err} /></div>
    </form>
  );
}

export function SettingsTabs({ clients, bots, team, emails, access, viewerId, isOwner }: {
  clients: Client[]; bots: Bot[]; team: TeamMember[]; emails: Record<string, string>; access: Record<string, string[]>; viewerId: string; isOwner: boolean;
}) {
  const [tab, setTab] = useState<"clients" | "bots" | "team">("clients");
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const done = () => setEditing(null);
  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5" role="tablist">
        {(["clients", "bots", "team"] as const).map((t) => <button key={t} type="button" role="tab" className="pill" aria-selected={tab === t} onClick={() => { setTab(t); setEditing(null); }}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <Err msg={err} />
      {tab === "clients" && (
        <section className="grid gap-3">
          {editing === "new:client" ? <div className="card p-4"><ClientForm onDone={done} /></div> : <div><button type="button" className="btn sm" onClick={() => setEditing("new:client")}>Add client</button></div>}
          <table className="grid"><thead><tr><th>Client</th><th>Plan</th><th>Status</th><th>Bodies</th><th>Bots</th><th></th></tr></thead>
            <tbody>{clients.map((c) => (
              <>
                <tr key={c.id}><td><Link href={`/clients/${c.slug}`} className="font-semibold">{c.name}</Link><div className="text-xs text-dim">{c.slug} · {c.timezone}{c.is_demo ? " · demo" : ""}</div></td><td>{c.plan ? PLAN_LABEL[c.plan] ?? c.plan : "—"}</td><td>{c.status}</td><td>{c.store_message_bodies ? <span className="tag you">on</span> : <span className="tag muted">off</span>}</td><td>{bots.filter((b) => b.client_id === c.id).length}</td>
                  <td className="text-right"><button type="button" className="pill sm" onClick={() => setEditing(editing === c.id ? null : c.id)}>Edit</button></td></tr>
                {editing === c.id && <tr key={`${c.id}-form`}><td colSpan={6}><ClientForm client={c} onDone={done} /></td></tr>}
              </>
            ))}</tbody></table>
        </section>
      )}
      {tab === "bots" && (
        <section className="grid gap-3">
          {editing === "new:bot" ? <div className="card p-4"><BotForm clients={clients} onDone={done} /></div> : <div><button type="button" className="btn sm" onClick={() => setEditing("new:bot")} disabled={!clients.length}>Add bot</button></div>}
          <table className="grid"><thead><tr><th>Bot</th><th>Client</th><th>Lane</th><th>Every</th><th>Enabled</th><th></th></tr></thead>
            <tbody>{bots.map((b) => (
              <>
                <tr key={b.id}><td><Link href={`/bots/${b.id}`} className="font-semibold">{b.name}</Link><div className="text-xs text-dim">{b.slug}</div></td><td>{clients.find((c) => c.id === b.client_id)?.name}</td><td>{LANE_LABEL[b.lane]}</td><td>{b.expected_interval_minutes}m</td><td>{b.enabled ? "yes" : <span className="tag skip">paused</span>}</td>
                  <td className="text-right"><button type="button" className="pill sm" onClick={() => setEditing(editing === b.id ? null : b.id)}>Edit</button></td></tr>
                {editing === b.id && <tr key={`${b.id}-form`}><td colSpan={6}><BotForm bot={b} clients={clients} onDone={done} /></td></tr>}
              </>
            ))}</tbody></table>
        </section>
      )}
      {tab === "team" && (
        <section className="grid gap-3">
          {editing === "new:member" ? <div className="card p-4"><TeamForm clients={clients} access={[]} isOwner={isOwner} onDone={done} /></div> : <div><button type="button" className="btn sm" onClick={() => setEditing("new:member")}>Invite teammate</button></div>}
          <p className="text-xs text-dim">Invites go out by email with a one-tap link. Access is enforced in the database, not just in these screens.</p>
          <table className="grid"><thead><tr><th>Member</th><th>Role</th><th>Sees</th><th>Since</th><th></th></tr></thead>
            <tbody>{team.map((m) => (
              <>
                <tr key={m.user_id}><td><span className="font-semibold">{m.display_name}</span>{m.user_id === viewerId ? <span className="tag muted ml-2">you</span> : null}<div className="text-xs text-dim">{emails[m.user_id] ?? "—"}</div></td><td>{m.role}</td>
                  <td className="text-sm">{m.all_clients || m.role === "owner" || m.role === "admin" ? "all clients" : (access[m.user_id] ?? []).map((id) => clients.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || <span className="text-dim">nothing yet</span>}</td>
                  <td><Time iso={m.created_at} mode="date" /></td>
                  <td className="text-right whitespace-nowrap"><button type="button" className="pill sm" onClick={() => setEditing(editing === m.user_id ? null : m.user_id)}>Edit</button>{m.user_id !== viewerId && <button type="button" className="pill sm ml-1" disabled={removing} onClick={() => { if (!confirm(`Remove ${m.display_name} from the team?`)) return; start(async () => { const r = await removeTeammate(m.user_id); if (!r.ok) setErr(r.error); }); }}>Remove</button>}</td></tr>
                {editing === m.user_id && <tr key={`${m.user_id}-form`}><td colSpan={5}><TeamForm member={m} email={emails[m.user_id]} clients={clients} access={access[m.user_id] ?? []} isOwner={isOwner} onDone={done} /></td></tr>}
              </>
            ))}</tbody></table>
        </section>
      )}
    </div>
  );
}
