"use client";

import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Processing sign-in...");

  useEffect(() => {
    (async () => {
      try {
        console.log("[AuthCallback] href =", window.location.href);

        // IMPORTANT: runs in browser – exchanges ?code&state -> tokens in localStorage
        const session = await fetchAuthSession();
        console.log("[AuthCallback] session =", session);

        setStatus("ok");
        setMessage("Signed in. Redirecting...");

        // (Optional) clean query params
        const url = new URL(window.location.href);
        url.search = "";
        window.history.replaceState({}, "", url.toString());

        // Go to your main app page
        setTimeout(() => {
          router.replace("/");
        }, 500);
      } catch (err: any) {
        console.error("[AuthCallback] error:", err);
        setStatus("error");
        setMessage(
          `Sign-in failed: ${err?.name || "Error"} – ${
            err?.message || "See console"
          }`,
        );
      }
    })();
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <h1>{status === "loading" ? "Signing you in…" : "Sign-in result"}</h1>
      <p>{message}</p>
    </main>
  );
}
