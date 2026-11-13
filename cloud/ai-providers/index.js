import openrouter from "./openrouter.js";
import vercel from "./vercel.js";
// Import cloudflare and sumopod here, then append them to PROVIDERS in that order.
export const PROVIDERS = [openrouter, vercel];
export const getProvider = (id) => PROVIDERS.find((provider) => provider.id === id);
