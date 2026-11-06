// Derives the public base URL + sandbox flag from an incoming Request. Used to
// build externally-shared URLs (webhooks, remote-agent send endpoints). Callers
// performing setup that needs a reachable public domain (e.g. registering a
// Telegram webhook) should check isSandbox and reject when true — external
// services cannot reach the sandbox or localhost.
export function getPublicBaseUrl(request: Request): { baseUrl: string; isSandbox: boolean } {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const isSandbox =
    url.hostname.includes(".sandbox.floot.app") ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  return { baseUrl, isSandbox };
}
