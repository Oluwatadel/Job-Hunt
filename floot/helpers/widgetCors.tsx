// helpers/widgetCors.tsx
//
// Shared CORS for every PUBLIC widget endpoint (session mint, widget chat). Fails
// CLOSED: an Origin not in ALLOWED_WIDGET_ORIGINS (comma-separated env) gets a 403
// and no allow-origin header. Never default to "*" — that lets any site drive
// your widget (and burn your credits).
export function resolveCorsOrigin(origin: string | null): string {
  const allowed: string[] = []; // Public widget endpoints are disabled.
  if (origin && allowed.includes(origin)) return origin;
  return "";
}

export function corsHeadersFor(allowedOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// Returns a Response to short-circuit with (403 / preflight 204), or null to
// proceed. Call at the top of every widget endpoint handler.
//
// SAME-ORIGIN IS ALWAYS ALLOWED, with no configuration: the most common support
// chat is a page served by this app itself (yourapp.com/support), not a
// cross-origin embed. Same-origin requests carry an Origin equal to the request
// host (POSTs) or no Origin at all (some GETs) — neither needs the
// ALLOWED_WIDGET_ORIGINS allowlist, which exists only for third-party embeds.
// Do NOT bypass the widget JWT for same-origin visitors — the session is what
// scopes an anonymous visitor to their own thread; only the CORS gate relaxes.
export function handleWidgetCors(request: Request): { headers: Record<string, string>; early: Response | null } {
  const origin = request.headers.get("Origin");
  if (!origin) {
    // No Origin header = same-origin navigation/GET (or a non-browser client,
    // for which CORS is meaningless anyway — the widget JWT is the auth).
    return { headers: { "Content-Type": "application/json" }, early: null };
  }
  let sameOrigin = false;
  try {
    const originHost = new URL(origin).host;
    sameOrigin =
      originHost === (request.headers.get("Host") ?? "") ||
      originHost === new URL(request.url).host;
  } catch {}
  const allowedOrigin = sameOrigin ? origin : resolveCorsOrigin(origin);
  if (allowedOrigin === "") {
    return {
      headers: { "Content-Type": "application/json" },
      early: new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const headers = corsHeadersFor(allowedOrigin);
  if (request.method === "OPTIONS") {
    return { headers, early: new Response(null, { status: 204, headers }) };
  }
  return { headers, early: null };
}
