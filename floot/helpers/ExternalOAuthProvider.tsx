import { randomBytes, createHash } from "crypto";
import type { OAuthProviderInterface, OAuthTokens, StandardUserData } from "./OAuthProvider";

/** Identity only: no repositories, jobs, Drive or Gmail permissions. */
export class ExternalOAuthProvider implements OAuthProviderInterface {
  public readonly clientId: string;
  private readonly secret: string;
  public readonly authUrl: string;
  public readonly scopes: string;
  public readonly name: "floot" | "github" | "linkedin";
  constructor(private readonly kind: "github" | "linkedin" | "google", public readonly redirectUri: string) {
    this.name = kind === "google" ? "floot" : kind;
    const prefix = kind.toUpperCase();
    this.clientId = (process.env as unknown as Record<string, string | undefined>)[`${prefix}_OAUTH_CLIENT_ID`] || "";
    this.secret = (process.env as unknown as Record<string, string | undefined>)[`${prefix}_OAUTH_CLIENT_SECRET`] || "";
    if (!this.clientId || !this.secret) throw new Error(`${kind} sign-in has not been configured by the owner yet.`);
    this.authUrl = kind === "github" ? "https://github.com/login/oauth/authorize" : kind === "linkedin" ? "https://www.linkedin.com/oauth/v2/authorization" : "https://accounts.google.com/o/oauth2/v2/auth";
    this.scopes = kind === "github" ? "read:user user:email" : "openid email profile";
  }
  generateAuthorizationUrl(state: string) {
    // GitHub supports S256 PKCE (since July 2025); LinkedIn uses a confidential client.
    const codeVerifier = this.kind === "linkedin" ? "" : randomBytes(32).toString("base64url");
    const p = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, scope: this.scopes, state, response_type: "code" });
    if (codeVerifier) { p.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url")); p.set("code_challenge_method", "S256"); }
    return { url: this.authUrl + "?" + p, codeVerifier };
  }
  async exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const url = this.kind === "github" ? "https://github.com/login/oauth/access_token" : this.kind === "linkedin" ? "https://www.linkedin.com/oauth/v2/accessToken" : "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (codeVerifier && this.kind !== "linkedin") body.set("code_verifier", codeVerifier);
    const r = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20000) });
    const data = await r.json();
    if (!r.ok || typeof data.access_token !== "string") throw new Error("The provider could not complete sign-in. Please try again.");
    return { accessToken: data.access_token, tokenType: "Bearer" };
  }
  async fetchUserInfo(tokens: OAuthTokens) {
    const headers = { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json", "User-Agent": "JobHunt" };
    const url = this.kind === "github" ? "https://api.github.com/user" : this.kind === "linkedin" ? "https://api.linkedin.com/v2/userinfo" : "https://openidconnect.googleapis.com/v1/userinfo";
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Unable to read the provider profile.");
    const info = await r.json();
    if (this.kind === "github") {
      const e = await fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(20000) });
      if (!e.ok) throw new Error("A verified GitHub email is required.");
      const emails = await e.json();
      const verified = Array.isArray(emails) ? emails.find((x: any) => x.primary && x.verified) ?? emails.find((x: any) => x.verified) : undefined;
      info.email = verified?.email; info.email_verified = !!verified;
    }
    return info;
  }
  mapUserData(info: any): StandardUserData {
    const id = this.kind === "github" ? info?.id : info?.sub;
    if (!id || info?.email_verified !== true || typeof info.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) throw new Error("This provider must supply a verified email address. Please use another sign-in method.");
    return { providerUserId: String(id), email: info.email.trim().toLowerCase(), displayName: String(info.name || info.login || info.email.split("@")[0]).slice(0,100), avatarUrl: info.picture || info.avatar_url || null };
  }
}
