// helpers/agentAttachments.tsx
//
// Presign-based attachments (images + PDFs), used by messages/upload + send and
// by the multi-user chat endpoints from floot-agents-access-control. The client
// asks an upload endpoint for a presigned PUT URL and PUTs the bytes DIRECTLY to
// storage (no base64 through an endpoint — Lambda payload limits), then
// references the file by storageFilename on send. Two rules keep this safe when
// the surface is not the trusted owner:
//   1. Files live under a per-principal hashed prefix, minted server-side; on
//      send the prefix is re-derived and checked — a caller can only reference
//      its own uploads.
//   2. The client never supplies a read URL; resolveAttachmentRefs derives it
//      via getUrl(), so a forged url field cannot point the agent at someone
//      else's file.
import crypto from "crypto";
import { upload, getUrl } from "@floot/storage";

// Structurally matches the access-control ThreadPrincipal; the owner surface
// uses OWNER_ATTACHMENT_PRINCIPAL.
export type AttachmentPrincipal = { kind: string; key: string };
export const OWNER_ATTACHMENT_PRINCIPAL: AttachmentPrincipal = { kind: "owner", key: "owner" };

export const ATTACHMENT_LIMITS = {
  maxPerMessage: 3,
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"],
} as const;

export type AttachmentRef = { storageFilename: string; contentType: string };
export type ResolvedAttachments = {
  imageUrls: string[];
  pdfUrls: string[];
  privateFiles: Array<{ storageFilename: string; url: string; expiresAt: string; type: "image" | "pdf" }>;
};

export function attachmentPrefixFor(principal: AttachmentPrincipal): string {
  const h = crypto.createHash("sha256").update(`${principal.kind}:${principal.key}`).digest("hex").slice(0, 16);
  return `chat/${principal.kind}/${h}/`;
}

function sanitizeFilename(name: string): string {
  const base = name.split("/").pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

// Mint a presigned PUT for one attachment. The client PUTs the bytes with
// header Content-Type: <contentType>, then passes { storageFilename, contentType }
// to the send endpoint.
export async function mintAttachmentUpload(opts: {
  principal: AttachmentPrincipal;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<
  | { ok: true; presignedUrl: string; url: string; storageFilename: string; expiresAt: string }
  | { ok: false; error: string }
> {
  if (!(ATTACHMENT_LIMITS.contentTypes as readonly string[]).includes(opts.contentType)) {
    return { ok: false, error: `Unsupported file type. Allowed: ${ATTACHMENT_LIMITS.contentTypes.join(", ")}` };
  }
  if (!Number.isFinite(opts.sizeBytes) || opts.sizeBytes <= 0 || opts.sizeBytes > ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, error: `File too large (max ${Math.round(ATTACHMENT_LIMITS.maxBytes / 1024 / 1024)}MB).` };
  }
  const storageFilename = `${attachmentPrefixFor(opts.principal)}${Date.now()}_${sanitizeFilename(opts.filename)}`;
  const r = await upload({
    visibility: "private",
    filename: storageFilename,
    contentType: opts.contentType,
    sizeBytes: opts.sizeBytes,
    expiresInSeconds: 86400,
  });
  if (!r.ok) return { ok: false, error: "Could not prepare the upload." };
  return {
    ok: true,
    presignedUrl: r.presignedUrl,
    url: r.url,
    storageFilename,
    expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  };
}

// Validate attachment refs on send and derive fresh read URLs server-side.
export async function resolveAttachmentRefs(
  principal: AttachmentPrincipal,
  attachments: AttachmentRef[],
): Promise<{ ok: true; resolved: ResolvedAttachments } | { ok: false; error: string }> {
  if (attachments.length > ATTACHMENT_LIMITS.maxPerMessage) {
    return { ok: false, error: `Too many attachments (max ${ATTACHMENT_LIMITS.maxPerMessage}).` };
  }
  const prefix = attachmentPrefixFor(principal);
  const resolved: ResolvedAttachments = { imageUrls: [], pdfUrls: [], privateFiles: [] };
  for (const a of attachments) {
    if (!a.storageFilename.startsWith(prefix)) {
      return { ok: false, error: "Attachment not found." }; // not this caller's upload — don't reveal more
    }
    if (!(ATTACHMENT_LIMITS.contentTypes as readonly string[]).includes(a.contentType)) {
      return { ok: false, error: "Unsupported attachment type." };
    }
    const r = await getUrl({ visibility: "private", filename: a.storageFilename, expiresInSeconds: 86400 });
    if (!r.ok) return { ok: false, error: "Attachment not found." };
    const type = a.contentType === "application/pdf" ? ("pdf" as const) : ("image" as const);
    if (type === "image") resolved.imageUrls.push(r.url);
    else resolved.pdfUrls.push(r.url);
    resolved.privateFiles.push({
      storageFilename: a.storageFilename,
      url: r.url,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      type,
    });
  }
  return { ok: true, resolved };
}

// PDFs are surfaced to the text-only model as reference lines appended to the
// message text; the agent reads them with the view_pdf tool. (Images go through
// enqueueUserMessage's imageUrls, which renders [Image N: url] lines.)
export function appendPdfLines(text: string, pdfUrls: string[]): string {
  if (pdfUrls.length === 0) return text;
  const lines = pdfUrls.map((url, i) => `[PDF ${i + 1}: ${url}]`).join("\n");
  return `${text}\n\n${lines}`;
}
