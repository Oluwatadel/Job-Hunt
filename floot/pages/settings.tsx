import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkspaceShell } from "../components/WorkspaceShell";
import { ConnectGoogleButton } from "../components/ConnectGoogleButton";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { apiClient } from "../helpers/apiClient";
import { useAuth } from "../helpers/useAuth";
import s from "../components/WorkspaceUI.module.css";
import styles from "./settings.module.css";

export default function Settings() {
  return <WorkspaceShell title="Your email settings." description="Choose the Google account that sends your applications. Find every confirmed send in that account’s Gmail Sent folder."><EmailSettings /></WorkspaceShell>;
}

function EmailSettings() {
  const { authState } = useAuth();
  const userId = authState.type === "authenticated" ? authState.user.id : 0;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["email", userId], queryFn: () => apiClient("email/status") });
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    setError("");
    await Promise.all([client.invalidateQueries({ queryKey: ["email", userId] }), client.invalidateQueries({ queryKey: ["drive", userId] })]);
  };
  if (query.isPending) return <p>Loading email settings…</p>;
  if (query.error) return <div role="alert" className={s.error}>{query.error.message}<Button variant="outline" onClick={() => query.refetch()}>Try again</Button></div>;
  const connection = query.data.connection;
  return <>
    {error && <div role="alert" className={s.error}>{error}</div>}
    <section className={s.panel}>
      <h2>Application email address</h2>
      <label className={s.field}>Send applications from<Input readOnly value={connection?.email ?? ""} placeholder="No Gmail account connected" /></label>
      <p className={s.muted}>Choose your address by signing in to Google below. The connected Google account is your sender; your Job Hunt login email can be different.</p>
      <p role="status">{connection?.canSend ? "Gmail sending enabled" : connection ? "Google connected · Gmail sending permission needed" : "Gmail is not connected"}</p>
      <div className={s.row}>
        <ConnectGoogleButton feature={["driveFile", "gmail"]} label={connection ? "Authorize Gmail / reconnect" : "Choose Gmail account"} onConnected={refresh} onError={setError} />
        {connection && <Button variant="outline" asChild><a href={connection.sentUrl} target="_blank" rel="noopener noreferrer">Open Gmail Sent</a></Button>}
        {connection && <Button variant="ghost" onClick={() => setDisconnecting(!disconnecting)}>Change email account…</Button>}
      </div>
      {disconnecting && <div className={s.notice} style={{ marginTop: 16 }}>
        Changing accounts disconnects both Gmail and Drive and removes this app’s document references and Gmail message links. Your PDFs and sent emails stay in Google. Connect the new account, then upload your CV/resume again. Existing send records keep the original sending address.
        <div className={s.row}><Button disabled={busy} variant="outline" onClick={async () => {
          setBusy(true); setError("");
          try { await apiClient("drive/disconnect", {}); setDisconnecting(false); await refresh(); }
          catch (e: any) { setError(e.message); } finally { setBusy(false); }
        }}>{busy ? "Disconnecting…" : "Disconnect current account"}</Button><Button variant="ghost" disabled={busy} onClick={() => setDisconnecting(false)}>Cancel</Button></div>
      </div>}
      <p className={s.muted}>Review the recipient, message and attachments in an application, then select “Send reviewed application”. Gmail sends it and keeps a copy in Sent. Connecting an account alone does not send anything.</p>
      <Link className={s.link} to="/documents">Manage CV and resume →</Link>
    </section>
    <section className={s.panel}>
      <div className={s.between}><h2>Application email history</h2><Button variant="outline" onClick={() => query.refetch()}>Refresh history</Button></div>
      <p className={s.muted}>Only sends confirmed by Gmail are labelled Sent. Older application notes and manually saved “Applied” statuses are not proof of an email send.</p>
      {query.data.submissions.length === 0 ? <div className={s.empty}>No application emails have been recorded here yet. Connect Gmail, open a job, and send your reviewed application to start a verified history.</div> :
        <div className={s.list}>{query.data.submissions.map((row: any) => <article className={s.item} key={row.applicationId}>
          <Link className={s.link} to={"/apply/" + row.applicationId}>{row.company} · {row.role}</Link>
          <p className={styles.address}>From: {row.googleEmail}</p>
          <p className={s.meta}>{new Date(row.createdAt).toLocaleString()} · {row.status === "sent" ? row.sentUrl ? "Sent — confirmed by Gmail" : "Previously sent — message link removed on disconnect" : "Sending not confirmed — check Gmail before retrying"}</p>
          {row.sentUrl && <a className={s.link} href={row.sentUrl} target="_blank" rel="noopener noreferrer">View email in Gmail Sent →</a>}
        </article>)}</div>}
    </section>
  </>;
}
