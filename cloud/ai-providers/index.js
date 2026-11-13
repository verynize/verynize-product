import openrouter from "./openrouter.js";
import vercel from "./vercel.js";
import cloudflare from "./cloudflare.js";
import sumopod from "./sumopod.js";

export const PROVIDERS = [openrouter, vercel, cloudflare, sumopod];
export const getProvider = (id) => PROVIDERS.find((provider) => provider.id === id);
