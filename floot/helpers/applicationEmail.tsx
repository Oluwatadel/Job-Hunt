export const applicationEmail = {
  async send(input: { from: string; to: string; subject: string; body: string; attachments: Array<{ kind: string; bytes: Buffer }> }, accessToken: string): Promise<string> {
    if ([input.from, input.to, input.subject].some(value => /[\r\n]/.test(value))) throw new Error("Invalid email header.");
    const boundary = "jobhunt_" + crypto.randomUUID();
    const encode = (bytes: Buffer) => bytes.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
    const parts = ["From: " + input.from, "To: " + input.to, "Subject: =?UTF-8?B?" + Buffer.from(input.subject).toString("base64") + "?=", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="' + boundary + '"', "", "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encode(Buffer.from(input.body))];
    for (const file of input.attachments) {
      if (!["cv", "resume"].includes(file.kind)) throw new Error("Invalid document kind.");
      parts.push("--" + boundary, "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="' + file.kind + '.pdf"', "Content-Transfer-Encoding: base64", "", encode(file.bytes));
    }
    parts.push("--" + boundary + "--", "");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(parts.join("\r\n")).toString("base64url") })
    });
    if (!response.ok) throw new Error("Gmail did not confirm sending.");
    const result = await response.json();
    if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(result.id)) throw new Error("Gmail returned no message receipt.");
    return result.id;
  },
  canSend(scopes: unknown): boolean {
    const allowed = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"];
    return Array.isArray(scopes) && scopes.some(scope => allowed.includes(scope));
  },
  sameSender(expected: string, connected: string): boolean {
    return expected.trim().toLowerCase() === connected.trim().toLowerCase();
  },
  sentUrl(email: string, messageId?: string | null): string {
    return "https://mail.google.com/mail/?authuser=" + encodeURIComponent(email) + "#sent" + (messageId ? "/" + encodeURIComponent(messageId) : "");
  }
};
