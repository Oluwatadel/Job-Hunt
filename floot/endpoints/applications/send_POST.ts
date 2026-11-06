import { db } from "../../helpers/db";
import { serverAccess as a } from "../../helpers/serverAccess";
import { googleAccess } from "../../helpers/googleAccess";
import { applicationEmail } from "../../helpers/applicationEmail";
import { saveApplication } from "../../helpers/saveApplication";
import { z } from "zod";
import superjson from "superjson";

export async function handle(request: Request) {
  try {
    const user = await a.current(request);
    if (!await a.paid(user)) a.fail("Pro or complimentary access required.", 402);
    const input = z.object({
      id: z.string().regex(/^\d+$/), senderEmail: z.string().email().max(254),
      to: z.string().email().max(254),
      subject: z.string().trim().min(1).max(250).refine(value => !/[\r\n]/.test(value)),
      body: z.string().trim().min(20).max(12000),
      documents: z.array(z.enum(["cv", "resume"])).min(1).max(2), approved: z.literal(true)
    }).safeParse(superjson.parse(await request.text()));
    if (!input.success) a.fail("Review the sender, recipient, message and attachments, then approve sending.", 400);
    const i = input.data;
    const job = await db.selectFrom("applications").selectAll().where("id", "=", i.id).where("userId", "=", user.id).executeTakeFirst();
    if (!job) a.fail("Application not found.", 404);
    if (job.dateApplied && ["applied", "interviewed", "offer", "rejected"].includes(job.status)) a.fail("This job already has an application date. Review its history before sending again.");
    const token = await googleAccess.token(user.id);
    if (!applicationEmail.canSend(token.scopes)) a.fail("Enable Gmail sending in Settings.", 409);
    if (!applicationEmail.sameSender(i.senderEmail, token.email)) a.fail("Your sending account changed. Refresh this page and review the new sender before sending.", 409);
    const docs = await Promise.all([...new Set(i.documents)].map(kind => googleAccess.file(user.id, kind)));
    if (docs.some(file => !applicationEmail.sameSender(file.document.googleEmail, token.email))) a.fail("Your document account changed. Refresh your documents before sending.", 409);
    const claimed = await db.transaction().execute(async tx => {
      await tx.selectFrom("users").select("id").where("id", "=", user.id).forUpdate().executeTakeFirstOrThrow();
      const existing = await tx.selectFrom("emailSubmissions").select("applicationId").where("applicationId", "=", job.id).where("userId", "=", user.id).executeTakeFirst();
      if (existing) a.fail("A send already exists for this job. Check Settings → Email history and Gmail Sent before retrying.", 409);
      const quota = await tx.selectFrom("emailSubmissions").select(tx.fn.countAll().as("n")).where("userId", "=", user.id).where("createdAt", ">", new Date(Date.now() - 86400000)).executeTakeFirstOrThrow();
      if (Number(quota.n) >= 5) a.fail("Daily email application limit reached (five).", 429);
      return tx.insertInto("emailSubmissions").values({ applicationId: job.id, userId: user.id, status: "sending", googleEmail: token.email })
        .onConflict(oc => oc.column("applicationId").doNothing()).returning("applicationId").executeTakeFirst();
    });
    if (!claimed) a.fail("A send already exists for this job. Check Settings → Email history and Gmail Sent before retrying.", 409);
    let messageId: string;
    try {
      messageId = await applicationEmail.send({ from: token.email, to: i.to, subject: i.subject, body: i.body, attachments: docs.map(file => ({ kind: file.document.kind, bytes: file.bytes })) }, token.access_token);
    } catch {
      await db.updateTable("emailSubmissions").set({ status: "unconfirmed" }).where("applicationId", "=", job.id).where("userId", "=", user.id).execute();
      a.fail("Sending was not confirmed. Check Gmail Sent in " + token.email + " before retrying; no automatic resend was made.", 409);
    }
    let warning: string | null = null;
    try {
      await db.updateTable("emailSubmissions").set({ status: "sent", messageId }).where("applicationId", "=", job.id).where("userId", "=", user.id).execute();
      await saveApplication(user, { ...job, dateApplied: new Date().toISOString(), lastContact: undefined, status: "applied", confirmation: "Gmail message " + messageId + " · " + token.email + " → " + i.to, nextAction: "Await employer reply." });
    } catch {
      warning = "Gmail confirmed sending, but the tracker could not finish saving. Do not resend. Keep this Gmail message reference: " + messageId;
    }
    return a.json({ sent: true, messageId, senderEmail: token.email, sentUrl: applicationEmail.sentUrl(token.email, messageId), warning });
  } catch (error) { return a.error(error); }
}
