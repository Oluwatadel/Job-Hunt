export async function handle() {
  return Response.json({ providers: [
    { id: "floot", name: "Google", enabled: !!((process.env.FLOOT_OAUTH_CLIENT_ID && process.env.FLOOT_OAUTH_CLIENT_SECRET) || ((process.env as unknown as Record<string, string | undefined>).GOOGLE_OAUTH_CLIENT_ID && (process.env as unknown as Record<string, string | undefined>).GOOGLE_OAUTH_CLIENT_SECRET)) },
    { id: "linkedin", name: "LinkedIn", enabled: !!((process.env as unknown as Record<string, string | undefined>).LINKEDIN_OAUTH_CLIENT_ID && (process.env as unknown as Record<string, string | undefined>).LINKEDIN_OAUTH_CLIENT_SECRET) },
    { id: "github", name: "GitHub", enabled: !!((process.env as unknown as Record<string, string | undefined>).GITHUB_OAUTH_CLIENT_ID && (process.env as unknown as Record<string, string | undefined>).GITHUB_OAUTH_CLIENT_SECRET) }
  ] }, { headers: { "Cache-Control": "no-store" } });
}
