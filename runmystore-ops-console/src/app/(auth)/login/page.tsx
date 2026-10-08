import type { Metadata } from "next";
import { Stripes } from "@/components/Stripes";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="flex-1 grid place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="wordmark mb-8"><span>RMS</span><Stripes /></p>
        <section className="panel hero p-6 sm:p-8 grid gap-6">
          <div className="grid gap-2">
            <h1 className="display text-3xl">Sign in</h1>
            <p className="text-dim text-sm">Team only. We email you a one-tap link, no password.</p>
          </div>
          <LoginForm next={next ?? "/"} initialError={error === "link" ? "That link has expired or was already used. Ask for a new one." : null} />
        </section>
      </div>
    </main>
  );
}
