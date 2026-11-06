declare module '*.module.css' { const classes: Record<string,string>; export default classes; }
declare module '@floot/ai' { export const flootAi: {chat(input: Record<string,unknown>):Promise<any>}; export class FlootAiOutOfCreditsError extends Error {} export class FlootAiRateLimitError extends Error {} }
