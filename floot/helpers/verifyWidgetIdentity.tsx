// helpers/verifyWidgetIdentity.tsx
//
// Server-to-server identity proof for the "identified" widget path. The site that
// embeds your widget already knows who its logged-in user is; to let your agent
// act on that user's real data, the site signs the user's id with a SHARED secret
// (WIDGET_IDENTITY_SECRET) and passes the signature to the session endpoint.
//
// The secret lives ONLY on the embedding site's server and yours — never ship it
// to the browser, or anyone can forge any identity. issuedAt gives a 5-minute
// replay window. Comparison is constant-time (timingSafeEqual) to avoid leaking
// the expected HMAC byte-by-byte.
import crypto from "crypto";

interface VerifyWidgetIdentityParams {
  externalUserId: string;
  signature: string;
  issuedAt?: number;
}

export function verifyWidgetIdentity(
  { externalUserId, signature, issuedAt }: VerifyWidgetIdentityParams,
  secret: string,
): { valid: boolean; error?: string } {
  // issuedAt is REQUIRED: it binds the signature to a 5-minute window. Without it a
  // captured signature would be replayable forever, so reject rather than fall back
  // to a static, timestamp-less signature. (Checked explicitly so issuedAt === 0 is
  // not silently treated as "absent".)
  if (issuedAt === undefined || issuedAt === null) {
    return { valid: false, error: "issuedAt is required" };
  }
  const now = Date.now();
  const age = now - issuedAt;
  if (age > 300000) {
    return { valid: false, error: "Signature expired (replay window)" };
  }
  if (age < -300000) {
    return { valid: false, error: "Signature issued in the future" };
  }

  const canonicalMessage = `${externalUserId}:${issuedAt}`;

  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(canonicalMessage)
    .digest("hex");

  try {
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedHmac, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Invalid signature length" };
    }

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { valid: false, error: "Invalid signature" };
    }
  } catch (error) {
    return { valid: false, error: "Malformed signature format" };
  }

  return { valid: true };
}
