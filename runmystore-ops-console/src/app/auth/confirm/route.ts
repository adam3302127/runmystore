import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Magic-link landing.
 * GET shows a one-button page and does NOT consume the token: chat apps and mail scanners prefetch links,
 * and a prefetch used to burn the single-use token before the person tapped it.
 * POST (the button) verifies the token hash and signs the user in. OAuth PKCE codes are verified on GET,
 * because they are bound to a cookie only this browser holds.
 */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

function page(tokenHash: string, type: string, next: string, error = false) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in · RMS Ops Console</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1a1a;color:#fff;font:16px/1.55 Inter,system-ui,sans-serif}
.p{width:min(420px,calc(100vw - 32px));background:#242424;border:1px solid #333;border-top:5px solid #0d7377;border-radius:6px 6px 14px 14px;padding:28px;box-shadow:0 40px 80px -30px rgba(0,0,0,.7)}
h1{margin:0 0 8px;font-size:1.6rem;font-style:italic;font-weight:800;letter-spacing:-.02em}p{margin:0 0 20px;color:rgba(255,255,255,.7);font-size:.95rem}
button{position:relative;isolation:isolate;border:0;background:none;color:#fff;font:inherit;font-weight:700;padding:12px 24px;cursor:pointer}
button::before{content:"";position:absolute;inset:0;z-index:-1;background:#0d7377;border-radius:6px;transform:skewX(-22deg)}
.e{color:#f5a37a}.m{font-size:1.5rem;font-style:italic;font-weight:800;letter-spacing:-.03em;margin-bottom:24px}</style></head>
<body><main class="p"><div class="m">RMS</div><h1>${error ? "That link has been used" : "Sign in to the Ops Console"}</h1>
<p>${error ? "Ask for a new link from the login page, or from Adam." : "Press the button to finish signing in. The link works once."}</p>
${error ? `<a href="/login" style="color:#fff">Go to login</a>` : `<form method="post" action="/auth/confirm"><input type="hidden" name="token_hash" value="${esc(tokenHash)}"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="next" value="${esc(next)}"><button type="submit">Continue →</button></form>`}
</main></body></html>`, { status: error ? 400 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function verify(request: NextRequest, tokenHash: string | null, type: string | null, code: string | null) {
  const supabase = await supabaseServer();
  if (tokenHash && type) return !(await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash })).error;
  if (code) return !(await supabase.auth.exchangeCodeForSession(code)).error;
  return false;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash"), type = sp.get("type"), code = sp.get("code"), next = safeNext(sp.get("next"));
  if (tokenHash && type) return page(tokenHash, type, next);
  const ok = await verify(request, null, null, code);
  const url = request.nextUrl.clone(); url.search = "";
  url.pathname = ok ? next : "/login"; if (!ok) url.search = "?error=link";
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? ""), type = String(form.get("type") ?? ""), next = safeNext(String(form.get("next") ?? "/"));
  const ok = await verify(request, tokenHash, type, null);
  if (!ok) return page(tokenHash, type, next, true);
  const url = request.nextUrl.clone(); url.search = ""; url.pathname = next;
  return NextResponse.redirect(url, { status: 303 });
}
