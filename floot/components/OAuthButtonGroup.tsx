import { useQuery } from "@tanstack/react-query";
import { OAuthLoginButton } from "./OAuthLoginButton";
import styles from "./OAuthButtonGroup.module.css";
type Provider = { id: string; name: string; enabled: boolean };
export function OAuthButtonGroup({ className, disabled, link = false }: { className?: string; disabled?: boolean; link?: boolean }) {
  const q = useQuery<{ providers: Provider[] }>({ queryKey: ["sign-in-providers"], queryFn: async () => { const r = await fetch("/_api/auth/providers"); if (!r.ok) throw new Error("Unable to load sign-in options."); return r.json(); }, staleTime: 60000 });
  if (q.isPending) return <p>Loading sign-in options…</p>;
  if (q.isError) return <p role="status">Social sign-in is unavailable. You can use email and password.</p>;
  return <div className={`${styles.container} ${className || ""}`}>
    {q.data.providers.map(p => <div key={p.id}><OAuthLoginButton provider={p.id} link={link} disabled={disabled || !p.enabled}>{link ? "Link" : "Continue with"} {p.name}</OAuthLoginButton>{!p.enabled && <small>{p.name} setup is pending.</small>}</div>)}
  </div>;
}
