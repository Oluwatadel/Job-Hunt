import { ExternalOAuthProvider } from "./ExternalOAuthProvider";
describe("Social identity safety",()=>{
 beforeEach(()=>{const env=process.env as unknown as Record<string,string>;for(const provider of ["GITHUB","LINKEDIN"]) {env[provider+"_OAUTH_CLIENT_ID"]="test-client";env[provider+"_OAUTH_CLIENT_SECRET"]="test-secret";}});
 it("uses GitHub S256 PKCE and identity scopes only",()=>{
  const p=new ExternalOAuthProvider("github","https://app.example/_api/auth/oauth_callback");const r=p.generateAuthorizationUrl("random-state");const u=new URL(r.url);
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");expect(r.codeVerifier.length).toBeGreaterThan(42);expect(u.searchParams.get("state")).toBe("random-state");expect(u.searchParams.get("scope")).toBe("read:user user:email");expect(u.searchParams.has("client_secret")).toBeFalse();
 });
 it("rejects missing or unverified provider email",()=>{
  const p=new ExternalOAuthProvider("linkedin","https://app.example/callback");
  for(const i of [{sub:"1"},{sub:"1",email:"a@example.com",email_verified:false},{sub:"1",email:"a@example.com"}])expect(()=>p.mapUserData(i)).toThrow();
 });
 it("keeps immutable provider subject and normalizes verified email",()=>{
  const p=new ExternalOAuthProvider("linkedin","https://app.example/callback");const u=p.mapUserData({sub:"immutable",email:"USER@EXAMPLE.COM",email_verified:true,name:"Test"});expect(u.providerUserId).toBe("immutable");expect(u.email).toBe("user@example.com");
 });
});
