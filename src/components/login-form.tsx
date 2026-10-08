"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up";

/**
 * Supabase returns codes like `invalid_credentials`. The learner needs the what and the
 * next step, so the raw message is never shown as is.
 */
function describeError(message: string, mode: Mode) {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "That email and password don't match an account.";
  }
  if (lower.includes("email not confirmed")) {
    return "Check your email to confirm the account, then sign in.";
  }
  if (lower.includes("already registered")) {
    return "That email already has an account. Sign in instead.";
  }
  if (lower.includes("password should be at least")) {
    return "Use a password with at least 8 characters.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }

  return mode === "sign-in"
    ? "Couldn't sign you in. Check the email and password and try again."
    : "Couldn't create the account. Check the connection and try again.";
}

export function LoginForm({
  next,
  linkError,
}: {
  /** Same-site path the learner was heading for, carried through the Proxy redirect. */
  next: string;
  /** Set by /auth/callback when a confirmation or sign-in link could not be used. */
  linkError: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? "That link has expired. Sign in again." : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = () => {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    const credentials = { email: email.trim(), password };

    const { error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    setIsSubmitting(false);

    if (error) {
      setError(describeError(error.message, mode));
      return;
    }

    if (mode === "sign-up") {
      // No session means the project asks for email confirmation first.
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setNotice("Check your email to confirm the account, then sign in.");
        setMode("sign-in");
        return;
      }
    }

    toast(mode === "sign-in" ? "Signed in" : "Account created");
    router.replace(next);
    router.refresh();
  };

  const isSignIn = mode === "sign-in";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="font-sans text-[15px] leading-[22px] font-medium">
        {isSignIn ? "Sign in" : "Create an account"}
      </h1>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-sans text-[15px] leading-[22px]">
          Email
        </label>
        <Input
          id="email"
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-sans text-[15px] leading-[22px]">
          Password
        </label>
        <Input
          id="password"
          type="password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={isSignIn ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>

      {error && (
        <p role="alert" className="font-sans text-[13px] leading-[18px] text-fix">
          {error}
        </p>
      )}

      {notice && (
        <p className="font-sans text-[13px] leading-[18px] text-muted-foreground">{notice}</p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSignIn ? "Sign in" : "Create account"}
      </Button>

      <Button type="button" variant="ghost" size="sm" onClick={switchMode} className="self-start">
        {isSignIn ? "No account yet? Create one" : "Already have an account? Sign in"}
      </Button>
    </form>
  );
}