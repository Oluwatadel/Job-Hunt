import { createHash, timingSafeEqual } from "crypto";
export const oauthBrowser = {
  cookie(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="))?.slice(name.length + 1) || ""; },
  hash(value: string) { return createHash("sha256").update(value).digest("hex"); },
  same(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); },
  cookieValue(value: string, age = 600) { return `oauth_browser=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`; }
};
