"use client";
import { useEffect, useState } from "react";
import { LayoutGrid, ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
export default function SignIn({
  setup = false,
  returnTo = "/",
}: {
  setup?: boolean;
  returnTo?: string;
}) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setReady(true);
    if (setup) {
      const fragment = window.location.hash.slice(1);
      if (fragment) setToken(fragment);
      window.history.replaceState(null, "", "/setup");
    }
  }, [setup]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const password = String(new FormData(event.currentTarget).get("password"));
    try {
      const res = await fetch(`/api/auth/${setup ? "setup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.assign(
        returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          SpendDesk<span className="brand-dot">.</span>
        </div>
        <div className="auth-icon">
          <LockKeyhole />
        </div>
        <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
        <h1>{setup ? "Make yourself at home." : "Welcome back."}</h1>
        <p className="muted">
          {setup
            ? "Choose a password to secure your stores and reporting."
            : "Sign in to review your stores, all in one place."}
        </p>
        <form method="post" onSubmit={submit}>
          <label>
            Dashboard password
            <input
              disabled={!ready}
              name="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              required
              minLength={setup ? 14 : 1}
              maxLength={256}
              placeholder={
                setup ? "At least 14 characters" : "Enter your password"
              }
            />
          </label>
          {setup && !token && (
            <p className="form-error">
              Open your private setup link to create your password.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button
            size="lg"
            disabled={!ready || busy || (setup && !token)}
            type="submit"
          >
            {busy ? "One moment…" : setup ? "Create my workspace" : "Sign in"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <small>
          Your Google and Shopify passwords are never requested here.
        </small>
        <nav className="auth-public-links" aria-label="About SpendDesk">
          <Link href="/about">About SpendDesk</Link>
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
        </nav>
      </div>
    </main>
  );
}
