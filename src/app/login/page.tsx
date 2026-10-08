import { LoginForm } from "@/components/login-form";

// The screen depends entirely on `?next=` and `?error=`, so there is no static shell
// worth prerendering. It only ever renders for a signed-out visitor.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Only same-site paths, so a crafted `?next=` can never send the learner to another host.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return <LoginForm next={destination} linkError={error === "link"} />;
}