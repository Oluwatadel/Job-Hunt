import * as React from "react";
import { Button } from "./Button";

type Feature = "gmail" | "calendar" | "driveFile";

type Props = {
  feature: Feature | Feature[];
  onConnected?:()=>void;
  onError?:(message:string)=>void;
  label?:string;
};

export function ConnectGoogleButton({ feature,onConnected,onError,label }: Props) {
  const [error,setError] = React.useState("");
  const [busy,setBusy] = React.useState(false);
  const cleanup = React.useRef<()=>void>(()=>{});
  React.useEffect(()=>()=>cleanup.current(),[]);
  const openFlow = () => {
    cleanup.current();
    setError("");
    const fail = (message:string) => { setError(message); onError?.(message); };
    const popup = window.open("about:blank", "google_integrations", "width=480,height=720");
    if (!popup) { fail("Allow popups for Job Hunt, then try connecting Google again."); return; }
    setBusy(true);
    let settled = false;
    let interval: ReturnType<typeof setInterval>;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => { settled = true; window.removeEventListener("message", listener); clearInterval(interval); clearTimeout(timeout); setBusy(false); };

    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (event.source !== popup) return;
      if (data?.type === "GOOGLE_INTEGRATION_SUCCESS") {
        finish();
        onConnected?.();
      } else if (data?.type === "GOOGLE_INTEGRATION_ERROR") {
        finish();
        fail(typeof data.error === "string" ? data.error : "Google connection failed. Please try again.");
      }
    };
    window.addEventListener("message", listener);
    interval = setInterval(() => { if (popup.closed && !settled) { finish(); fail("Google connection was closed. Check your connection status or try again."); } },1000);
    timeout = setTimeout(() => { if (!settled) { finish(); popup.close(); fail("Google connection timed out. Please try again."); } },300000);
    cleanup.current = finish;

    const features = Array.isArray(feature) ? feature : [feature];
    fetch(`/_api/auth/google_integrations_authorize?feature=${encodeURIComponent(features.join(","))}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.authorize_url) throw new Error("Unable to start Google connection. Please sign in and try again.");
        if (settled) return;
        popup.location.href = data.authorize_url;
      })
      .catch(() => {
        if (settled) return;
        finish();
        popup.close();
        fail("Unable to start Google connection. Please sign in and try again.");
      });
  };

  return (
    <div><Button type="button" onClick={openFlow} disabled={busy}>
      {busy ? "Connecting…" : label || "Connect Google"}
    </Button>{error && <p role="alert">{error}</p>}</div>
  );
}
