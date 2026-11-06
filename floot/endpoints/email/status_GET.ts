import { db } from "../../helpers/db";
import { serverAccess as a } from "../../helpers/serverAccess";
import { applicationEmail } from "../../helpers/applicationEmail";

export async function handle(request: Request) {
  try {
    const user = await a.current(request);
    const connection = await db.selectFrom("googleConnections").select(["email", "scopes"]).where("userId", "=", user.id).executeTakeFirst();
    const applicationId = new URL(request.url).searchParams.get("applicationId");
    let query = db.selectFrom("emailSubmissions as e")
      .innerJoin("applications as j", "j.id", "e.applicationId")
      .select(["e.applicationId", "e.status", "e.googleEmail", "e.messageId", "e.createdAt", "j.company", "j.role"])
      .where("e.userId", "=", user.id).where("j.userId", "=", user.id);
    if (applicationId) {
      if (!/^\d+$/.test(applicationId)) a.fail("Invalid application.");
      query = query.where("e.applicationId", "=", applicationId);
    }
    const submissions = await query.orderBy("e.createdAt", "desc").limit(50).execute();
    return a.json({
      connection: connection ? { email: connection.email, canSend: applicationEmail.canSend(connection.scopes), sentUrl: applicationEmail.sentUrl(connection.email) } : null,
      submissions: submissions.map(row => ({ ...row, sentUrl: row.status === "sent" && row.messageId ? applicationEmail.sentUrl(row.googleEmail, row.messageId) : null }))
    });
  } catch (error) { return a.error(error); }
}
