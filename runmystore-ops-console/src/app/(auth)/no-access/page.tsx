import type { Metadata } from "next";
import { Stripes } from "@/components/Stripes";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="flex-1 grid place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="wordmark mb-8"><span>RMS</span><Stripes /></p>
        <section className="panel hero p-6 sm:p-8 grid gap-5">
          <h1 className="display text-3xl">No access yet</h1>
          <p className="text-dim text-sm">
            {user?.email ? <>You&apos;re signed in as <strong className="text-white">{user.email}</strong>, but that address isn&apos;t on the RMS team list.</> : <>This console is for the RMS team.</>}
            {" "}Ask an admin to add you under Settings → Team, then sign in again.
          </p>
          <form action="/auth/signout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
        </section>
      </div>
    </main>
  );
}
