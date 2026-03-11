"use client";

import { FormEvent, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export default function LoginPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (storedToken) router.replace("/dashboard");
  }, [router]);

  async function handleRequestCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/request-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not request code");
      setMessage(result.message ?? "Code sent.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Something went wrong";
      setMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });
      const result = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error ?? "Invalid code");

      window.localStorage.setItem(localStorageTokenKey, result.token);
      router.push("/dashboard");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Something went wrong";
      setMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">GTMbench</h1>
        <p className="text-sm text-zinc-600">Sign in to continue</p>
      </header>

      <section className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <form className="grid gap-3" onSubmit={handleRequestCode}>
          <h2 className="text-lg font-medium text-zinc-900">Request OTP</h2>
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
          <button
            className="rounded-md bg-zinc-900 px-3 py-2 text-white disabled:opacity-60"
            disabled={isLoading}
            type="submit"
          >
            Send Code
          </button>
        </form>

        <hr className="border-zinc-200" />

        <form className="grid gap-3" onSubmit={handleVerifyCode}>
          <h2 className="text-lg font-medium text-zinc-900">Verify OTP</h2>
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            type="text"
            value={otpCode}
            onChange={(event) => setOtpCode(event.target.value)}
            placeholder="7777"
            required
          />
          <button
            className="rounded-md bg-zinc-900 px-3 py-2 text-white disabled:opacity-60"
            disabled={isLoading}
            type="submit"
          >
            Verify & Login
          </button>
        </form>
      </section>

      {message ? (
        <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          {message}
        </p>
      ) : null}
    </main>
  );
}
