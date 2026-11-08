import { useEffect, useState } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { can } from "@/lib/platform";
import { Card, Row, Section, SettingsButton, TextField } from "./controls";
import {
  imageProviderApi,
  providerCatalog,
  type ImageSettings,
  type KeyState,
  type Vendor,
} from "./image-provider-api";

function KeyRow({
  vendor,
  state,
  busy,
  save,
}: {
  vendor: Vendor;
  state: KeyState;
  busy: boolean;
  save: (vendor: Vendor, key: string, remove: boolean) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const label = vendor === "google" ? "Google" : vendor === "openai" ? "OpenAI" : "Custom endpoint";
  const submit = async (remove: boolean) => {
    const value = key.trim();
    setKey("");
    await save(vendor, value, remove);
  };
  return (
    <Row
      title={`${label} API key`}
      htmlFor={`settings-image-key-${vendor}`}
      description={
        state.hasKey
          ? state.keyStorage === "keychain"
            ? "Saved securely on this device"
            : "Saved for this session only"
          : "No key saved"
      }
    >
      <TextField
        id={`settings-image-key-${vendor}`}
        className="w-36"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        placeholder={state.hasKey ? "Replace key" : "API key"}
        disabled={busy}
        onChange={(e) => setKey(e.target.value)}
      />
      <SettingsButton disabled={busy || !key.trim()} onClick={() => void submit(false)}>
        Save
      </SettingsButton>
      <SettingsButton disabled={busy || !state.hasKey} onClick={() => void submit(true)}>
        Remove
      </SettingsButton>
    </Row>
  );
}

export function ImportGenerationSection() {
  const enabled = can("imageGeneration");
  const [settings, setSettings] = useState<ImageSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    imageProviderApi
      .get()
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch(() => {
        if (live) setMessage("Unable to load image providers. Reopen Settings to retry.");
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  const providers = settings ? providerCatalog(settings) : [];
  const save = async (patch: Parameters<typeof imageProviderApi.set>[0]) => {
    setBusy(true);
    setMessage("");
    try {
      setSettings(await imageProviderApi.set(patch));
      setMessage("Image settings saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save image settings. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div id="settings-import-generation">
      <Section id="settings-import-generation" title="Import & generation">
        <Card>
          <Row
            title="Default image generation provider"
            htmlFor="settings-image-provider"
            description={!enabled ? "Available in the desktop app" : undefined}
          >
            <Select
              value={settings?.defaultProvider || "custom"}
              disabled={!enabled || !settings || busy}
              onValueChange={(defaultProvider) => void save({ defaultProvider })}
            >
              <SelectTrigger id="settings-image-provider">
                <SelectValue placeholder="Custom endpoint" />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {providers.map((provider) => (
                  <SelectPrimitive.Item
                    key={provider.id}
                    value={provider.id}
                    className="flex cursor-default items-center justify-between gap-4 rounded-sm px-2 py-2 text-sm outline-none focus:bg-accent"
                  >
                    <SelectPrimitive.ItemText>{provider.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator>
                      <span
                        data-provider-current
                        aria-hidden
                        className="block size-1.5 rounded-full bg-foreground"
                      />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {enabled && (
            <Row
              title="Codex · ChatGPT plan"
              description="Uses your Codex login on this computer. No image API key needed."
            >
              <span>
                {providers.find((provider) => provider.id === "codex_plan")?.status ||
                  "Checking status"}
              </span>
            </Row>
          )}
          <details>
            <summary className="cursor-pointer px-4 py-2 text-sm">Use your own API key</summary>
            {enabled &&
              settings &&
              (settings.keys
                ? (["google", "openai", "custom"] as const)
                : (["custom"] as const)
              ).map((vendor) => (
                <KeyRow
                  key={vendor}
                  vendor={vendor}
                  state={settings.keys?.[vendor] || settings}
                  busy={busy}
                  save={(vendor, apiKey, remove) =>
                    save({
                      ...(settings.keys ? { vendor } : {}),
                      ...(remove ? { clearKey: true } : { apiKey }),
                    })
                  }
                />
              ))}
          </details>
        </Card>
        <p role="status" className="mt-2 px-4 text-sm text-muted-foreground">
          {message}
        </p>
      </Section>
    </div>
  );
}
