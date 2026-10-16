"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
export default function McpConsent({
  query,
  allowRefresh = false,
}: {
  query: string;
  allowRefresh?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function allow() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/oauth/authorize", {
        method: "POST",
        body: new URLSearchParams({ query }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          "The connection could not be authorized. Start again from ChatGPT.",
        );
      window.location.assign(data.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="lg" disabled={!ready || busy} onClick={allow}>
        {busy
          ? "Connecting…"
          : allowRefresh
            ? "Allow access and report refresh"
            : "Allow read-only access"}
      </Button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
