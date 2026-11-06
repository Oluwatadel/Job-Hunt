import { OAuthProviderInterface, OAuthProviderType } from "./OAuthProvider";
import { FlootOAuthProvider } from "./FlootOAuthProvider";
import { ExternalOAuthProvider } from "./ExternalOAuthProvider";
export function getOAuthProvider(name: OAuthProviderType, redirectUri: string): OAuthProviderInterface {
  if (name === "floot") {
    // A self-hosted deployment supplies its own Google client instead of Floot's broker.
    if ((process.env as unknown as Record<string, string | undefined>).GOOGLE_OAUTH_CLIENT_ID) return new ExternalOAuthProvider("google", redirectUri);
    return new FlootOAuthProvider(redirectUri);
  }
  return new ExternalOAuthProvider(name, redirectUri);
}
