import { platform } from "@/lib/platform";

export type Vendor = "google" | "openai" | "custom";
export type KeyState = { hasKey: boolean; keyStorage: string };
export type Provider = {
  id: string;
  label: string;
  vendor: Vendor | "codex";
  status?: string;
  model: string;
  hasKey: boolean;
  available: boolean;
};
type Custom = { provider: string; baseURL: string; model: string; size: string };
export type ImageSettings = Custom &
  KeyState & {
    defaultProvider?: string;
    providers?: Provider[];
    keys?: Record<Vendor, KeyState>;
    custom?: Custom;
    secureStorage: boolean | null;
    configured: boolean;
  };
export type ImageSettingsPatch = Partial<Custom> & {
  defaultProvider?: string;
  vendor?: Vendor;
  apiKey?: string;
  clearKey?: boolean;
  custom?: Partial<Custom>;
};
export function providerCatalog(settings: ImageSettings): Provider[] {
  return settings.providers?.length
    ? settings.providers
    : [
        {
          id: "custom",
          label: "Custom endpoint",
          vendor: "custom",
          model: settings.model,
          hasKey: settings.hasKey,
          available: settings.configured,
        },
      ];
}
export const imageProviderApi = {
  async get(): Promise<ImageSettings> {
    return (await platform.desktop!.imageProvider.get()) as ImageSettings;
  },
  async set(patch: ImageSettingsPatch): Promise<ImageSettings> {
    await platform.desktop!.imageProvider.set(patch);
    return imageProviderApi.get();
  },
};
