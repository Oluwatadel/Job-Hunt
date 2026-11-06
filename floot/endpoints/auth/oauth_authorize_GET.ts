import { db } from "../../helpers/db";
import { randomBytes } from "crypto";
import { getOAuthProvider } from "../../helpers/getOAuthProvider";
import { getOAuthRedirectUri } from "../../helpers/getOAuthRedirectUri";
import { schema } from "./oauth_authorize_GET.schema";
import { oauthBrowser as b } from "../../helpers/oauthBrowser";
import { serverAccess as a } from "../../helpers/serverAccess";
import { createOAuthPopupResponseHtml } from "../../helpers/oauthPopupMessage";
export async function handle(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Start sign-in from this app.");
    const url = new URL(request.url);
    const { provider } = schema.parse({ provider: url.searchParams.get("provider") });
    const linkUserId = url.searchParams.get("link") === "1" ? (await a.current(request)).id : null;
    const p = getOAuthProvider(provider, getOAuthRedirectUri(request.url));
    const state = randomBytes(32).toString("hex"), browser = randomBytes(32).toString("hex");
    const { url: target, codeVerifier } = p.generateAuthorizationUrl(state);
    await db.deleteFrom("oauthStates").where("expiresAt", "<", new Date()).execute();
    await db.insertInto("oauthStates").values({ state, provider, redirectUrl: p.redirectUri, codeVerifier: JSON.stringify({ pkce: codeVerifier, linkUserId, browserHash: b.hash(browser) }), expiresAt: new Date(Date.now() + 600000) }).execute();
    return new Response("Redirecting…", { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Set-Cookie": b.cookieValue(browser) } });
  } catch (e) {
    return new Response(createOAuthPopupResponseHtml({ type: "OAUTH_ERROR", provider: "unknown", error: { message: e instanceof Error ? e.message : "Unable to start sign-in." } }), { status: 400, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  }
}
