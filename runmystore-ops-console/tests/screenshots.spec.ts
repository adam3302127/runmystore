import { test } from "@playwright/test";
import { ensureUser, signIn } from "./helpers";

import { join } from "node:path";
import { tmpdir } from "node:os";
/** Screenshots at 1440 and 390 for the checkpoint review. Output: $SCREENSHOT_DIR or <tmp>/rms-ops-console-screenshots. */
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "rms-ops-console-screenshots");
for (const [name, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]] as const) {
  test(`screenshots ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const owner = await ensureUser("owner.test@example.com", "Test Owner", "owner", true);
    await signIn(page, owner.email);
    for (const [path, file] of [["/", "fleet"], ["/feed?client=fresh-bros", "timeline"], ["/decisions", "decisions"], ["/inbox?client=fresh-bros", "inbox"], ["/clients/fresh-bros", "client"], ["/search?q=care%20pack", "search"]]) {
      await page.goto(path);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(OUT, `${file}-${name}.png`), fullPage: file !== "fleet" });
    }
    await ctx.close();
  });
}
