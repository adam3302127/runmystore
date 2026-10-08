import { test, expect } from "@playwright/test";
import { botKey, ensureUser, ingest, inbox, signIn, sql, uid, type TestUser } from "./helpers";

let owner: TestUser; let operator: TestUser; let viewer: TestUser;
let careKey: { key: string; botId: string; clientId: string };

test.beforeAll(async () => {
  owner = await ensureUser("owner.test@example.com", "Test Owner", "owner", true);
  operator = await ensureUser("northside.op@example.com", "Northside Operator", "operator", false, ["northside-candle"]);
  viewer = await ensureUser("viewer.test@example.com", "Test Viewer", "viewer", true);
  careKey = await botKey("fresh-bros", "care-pack");
});

test("ingest contract: 201, duplicate 200, bad key 401, bad shape 422, decision without decision 422", async () => {
  const k = `pw:${uid()}`;
  const first = await ingest(careKey.key, { type: "action", summary: "Playwright check", idempotency_key: k });
  expect(first.status).toBe(201);
  const dup = await ingest(careKey.key, { type: "action", summary: "Playwright check", idempotency_key: k });
  expect(dup.status).toBe(200); expect(dup.body.duplicate).toBe(true);
  expect((await ingest("rmsb_00000000_" + "0".repeat(48), { type: "action", summary: "x" })).status).toBe(401);
  expect((await ingest(careKey.key, { type: "nope", summary: "" })).status).toBe(422);
  expect((await ingest(careKey.key, { type: "decision_needed", summary: "needs a decision object" })).status).toBe(422);
});

test("privacy: with store_message_bodies=false, message detail and payload.body are not stored", async () => {
  const k = `pw:${uid()}`;
  const r = await ingest(careKey.key, { type: "message_received", summary: "Privacy check", channel: "email", direction: "inbound", detail: "secret body", payload: { body: "secret", order_id: "1" }, idempotency_key: k });
  expect(r.status).toBe(201);
  const rows = await sql<{ detail: string | null; payload: Record<string, unknown> }>(`select detail, payload from public.events where bot_id = $1 and idempotency_key = $2`, [careKey.botId, k]);
  expect(rows[0].detail).toBeNull();
  expect(rows[0].payload.body).toBeUndefined();
  expect(rows[0].payload.order_id).toBe("1");
});

test("a new event appears in the open feed in under 2 s without a refresh", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/");
  await expect(page.getByTestId("live-feed")).toBeVisible();
  await expect(page.getByTestId("live-feed").getByText(/^Live/)).toBeVisible({ timeout: 15_000 });
  const marker = `Live check ${uid()}`;
  const t0 = Date.now();
  const r = await ingest(careKey.key, { type: "action", summary: marker, idempotency_key: `pw:${uid()}` });
  expect(r.status).toBe(201);
  await expect(page.getByTestId("feed-rows").getByText(marker)).toBeVisible({ timeout: 2000 });
  expect(Date.now() - t0).toBeLessThan(2500);
});

test("a paused feed shows +N new and does not reflow until Play", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/");
  await expect(page.getByTestId("live-feed").getByText(/^Live/)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("feed-pause").click();
  await expect(page.getByTestId("feed-pause")).toHaveText("Play");
  const marker = `Paused check ${uid()}`;
  await ingest(careKey.key, { type: "action", summary: marker, idempotency_key: `pw:${uid()}` });
  await expect(page.getByTestId("feed-queued")).toContainText("+1 new", { timeout: 5000 });
  await expect(page.getByTestId("feed-rows").getByText(marker)).toHaveCount(0);
  await page.getByTestId("feed-pause").click();
  await expect(page.getByTestId("feed-rows").getByText(marker)).toBeVisible();
});

test("a scoped operator sees only Northside Candle: screens, API, realtime", async ({ page }) => {
  await signIn(page, operator.email);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Northside Candle Co. (demo)" })).toBeVisible();
  await expect(page.getByText("Fresh Bros", { exact: true })).toHaveCount(0);
  for (const path of ["/feed", "/inbox", "/decisions", "/clients"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("Fresh Bros");
  }
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  // Realtime: a Fresh Bros event must not reach the operator's feed
  const marker = `Scoped leak check ${uid()}`;
  await page.goto("/");
  await expect(page.getByTestId("live-feed").getByText(/^Live/)).toBeVisible({ timeout: 15_000 });
  await ingest(careKey.key, { type: "action", summary: marker, idempotency_key: `pw:${uid()}` });
  await page.waitForTimeout(2500);
  await expect(page.getByText(marker)).toHaveCount(0);
});

test("REST as the operator returns zero Fresh Bros events", async () => {
  // Sign the operator in through the GoTrue API directly and query PostgREST with that JWT.
  const { createClient } = await import("@supabase/supabase-js");
  const a = (await import("./helpers")).admin();
  const link = await a.auth.admin.generateLink({ type: "magiclink", email: operator.email });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const v = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties!.hashed_token });
  expect(v.error).toBeNull();
  const { data: fb } = await sb.from("events").select("id").eq("client_id", careKey.clientId).limit(5);
  expect(fb ?? []).toHaveLength(0);
  const { data: mine } = await sb.from("events").select("client_id").limit(50);
  expect(new Set((mine ?? []).map((r) => r.client_id)).size).toBe(1);
});

test("a revoked key gets 401 right away", async () => {
  const fresh = await botKey("fresh-bros", "care-pack");
  expect((await ingest(fresh.key, { type: "heartbeat", summary: "Alive", idempotency_key: `pw:${uid()}` })).status).toBe(201);
  await sql(`update public.bot_keys set revoked_at = now() where prefix = $1`, [fresh.key.split("_")[1]]);
  expect((await ingest(fresh.key, { type: "heartbeat", summary: "Alive", idempotency_key: `pw:${uid()}` })).status).toBe(401);
});

test("answering a decision resolves its event, drops the badge live, and the bot receives the answer once", async ({ page }) => {
  await inbox(careKey.key); // drain anything older
  const k = `pw:${uid()}`;
  const r = await ingest(careKey.key, { type: "decision_needed", summary: `Decision check ${k}`, idempotency_key: k,
    decision: { question: `Approve the Playwright care pack ${k}?`, options: [{ key: "approve", label: "Approve" }, { key: "deny", label: "Deny" }], priority: 3 } });
  expect(r.status).toBe(201);
  const eventId = r.body.ids![0];
  await signIn(page, owner.email);
  await page.goto("/");
  const card = page.getByTestId("bot-card").filter({ hasText: "Care Pack" }).first();
  const before = Number((await card.getByTestId("open-decisions").textContent())?.match(/\d+/)?.[0] ?? "0");
  expect(before).toBeGreaterThan(0);
  await page.goto("/decisions?bot=" + careKey.botId);
  const dc = page.getByTestId("decision-card").filter({ hasText: k });
  await expect(dc).toBeVisible();
  await dc.getByTestId("answer-approve").click();
  await expect(dc).toHaveCount(0, { timeout: 5000 });
  const ev = await sql<{ status: string }>(`select status from public.events where id = $1`, [eventId]);
  expect(ev[0].status).toBe("resolved");
  await page.goto("/");
  const after = Number((await card.getByTestId("open-decisions").textContent().catch(() => "0"))?.match(/\d+/)?.[0] ?? "0");
  expect(after).toBe(before - 1);
  const first = await inbox(careKey.key);
  expect(first.body.decisions?.some((d) => d.answer_key === "approve")).toBe(true);
  const second = await inbox(careKey.key);
  expect(second.body.decisions ?? []).toHaveLength(0);
});

test("viewer can read but not act", async ({ page }) => {
  await signIn(page, viewer.email);
  await page.goto("/decisions");
  await expect(page.getByText("Viewers can read decisions")).toBeVisible();
  await expect(page.getByTestId("answer-approve")).toHaveCount(0);
});

test("under reduced motion there are no entrance or pulse animations", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await signIn(page, owner.email);
  await page.goto("/");
  await expect(page.getByTestId("live-feed").getByText(/^Live/)).toBeVisible({ timeout: 15_000 });
  const dotAnim = await page.locator(".dot.live").first().evaluate((el) => getComputedStyle(el).animationName);
  expect(dotAnim).toBe("none");
  const marker = `Reduced motion ${uid()}`;
  await ingest(careKey.key, { type: "action", summary: marker, idempotency_key: `pw:${uid()}` });
  const row = page.getByTestId("feed-rows").locator("li", { hasText: marker }).first();
  await expect(row).toBeVisible({ timeout: 3000 });
  const style = await row.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));
  expect(style.opacity).toBe("1");
  expect(style.transform).toBe("none");
  await ctx.close();
});

test("history: timeline paginates months back with date filters, drawer opens, search finds the care flow", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/feed?client=fresh-bros&bot=" + careKey.botId);
  await expect(page.getByTestId("timeline")).toBeVisible();
  const rows = page.getByTestId("timeline").locator("li[data-event-id]");
  await expect.poll(async () => rows.count()).toBeGreaterThan(30);
  const n1 = await rows.count();
  await page.mouse.wheel(0, 20000);
  await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(n1);
  await rows.first().locator("button").click();
  await expect(page.getByTestId("event-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("event-drawer")).toHaveCount(0);
  const from = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10), to = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  await page.goto(`/feed?client=fresh-bros&from=${from}&to=${to}`);
  await expect.poll(async () => rows.count()).toBeGreaterThan(10);
  await page.goto("/search?q=melted%20gummies");
  await expect.poll(async () => rows.count()).toBeGreaterThan(5);
});

test("screens render: bot page with keys, inbox threads, client page with daily summary, settings", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/bots/" + careKey.botId);
  await expect(page.getByRole("heading", { name: /Care Pack/ })).toBeVisible();
  await expect(page.getByTestId("keys-panel")).toBeVisible();
  await page.getByLabel("Key label").fill("pw");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("new-key")).toContainText("RMS_BOT_KEY=rmsb_");
  await page.goto("/inbox?client=fresh-bros");
  await expect(page.getByTestId("inbox")).toBeVisible();
  await page.getByRole("button", { name: /wrote in|replied|Told/ }).first().click();
  await expect(page.locator(".msg").first()).toBeVisible();
  await page.goto("/clients/fresh-bros");
  await expect(page.getByTestId("daily-summary")).toContainText("Good morning");
  await page.goto("/settings");
  await expect(page.getByRole("tab", { name: "Team" })).toBeVisible();
});
