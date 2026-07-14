"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Sign-in failed. Check your email and password.");
      setLoading(false);
      return;
    }
    router.push(search.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!isSupabaseConfigured && (
        <Alert tone="warning" title="Backend not configured">
          Supabase environment variables are missing. Copy{" "}
          <code>.env.example</code> to <code>.env.local</code> and fill in the
          South Point project keys. Until then the app runs in UI preview mode.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Email">
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@southpoint.ph"
        />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!isSupabaseConfigured}
      >
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Warm brand backdrop: a soft sun glow up top, a cool court glow below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 32rem at 50% -8%, var(--sun-soft), transparent 60%), radial-gradient(52rem 30rem at 50% 115%, var(--court-soft), transparent 62%)",
        }}
      />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="sr-only">Sign in to South Point Cafe &amp; Lounge</h1>
          <Wordmark size="lg" />
          <p className="mt-5 text-sm text-latte">
            Courtside cafe · Convenience store · Pickleball lounge
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-6 shadow-(--shadow-card)">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-latte">
          Staff accounts are created by the owner from the Staff page.
        </p>
      </div>
    </div>
  );
}
