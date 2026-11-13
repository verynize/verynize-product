import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { aiConfigQuery, webAgentScope } from "@/lib/agent-transport";
import { aiProviders, type AiProvider } from "@/lib/agent-service";
import {
  AiCredentialError,
  type OpenRouterCredential,
  aiCredentialsQuery,
  connectOpenRouter,
  disconnectAiProvider,
  saveAiCredential,
  openRouterReturn,
  openRouterReturnMessage,
} from "@/lib/ai-credentials";
import { useCloudAccount, openSignIn } from "@/lib/cloud-account";
import { platform } from "@/lib/platform";
import { SIGNED_OUT, type AccountScope } from "@/lib/query/keys";
import { setAiDefaultModel, useAiDefaultModel } from "@/lib/ai-preferences";
import { Card, IconTile, NativeSelect, Row, Section, SettingsButton, TextField } from "./controls";
import { OpenRouterSection, describe } from "./openrouter";

export function ModelApiSection() {
  const account = useCloudAccount();
  const scope = platform.kind === "web" ? webAgentScope(account) : null;
  const config = useQuery({ ...aiConfigQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  if (platform.kind !== "web") return null;
  if (config.error)
    return (
      <Section title="Model API" description="Could not load this server's providers.">
        <p role="alert" className="text-sm text-destructive">
          {config.error.message}
        </p>
        <SettingsButton onClick={() => void config.refetch()}>Try again</SettingsButton>
      </Section>
    );
  if (!config.data?.providers) return <OpenRouterSection />;
  return (
    <Section
      id="settings-openrouter"
      title="Model API"
      description="Connect a provider to use its models and credits for web chat. Default models are saved for this account in this browser."
    >
      <div className="flex flex-col gap-3">
        {aiProviders(config.data).map((provider) => (
          <ProviderCard
            key={JSON.stringify([scope, provider.id])}
            provider={provider}
            scope={scope}
          />
        ))}
      </div>
    </Section>
  );
}

function ProviderCard({ provider, scope }: { provider: AiProvider; scope: AccountScope | null }) {
  const query = useQuery({ ...aiCredentialsQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  const openrouter = provider.id === "openrouter";
  const prefix = openrouter ? "settings-openrouter" : `settings-ai-provider-${provider.id}`;
  const returned = openrouter ? openRouterReturn() : null;
  const [error, setError] = useState(
    returned?.status === "error" ? openRouterReturnMessage(returned.reason) : "",
  );
  const [fieldError, setFieldError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const credential = query.data?.[provider.id];
  const status = connectionStatus(scope, query.isPending, !!query.error, credential, provider);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setFieldError(undefined);
    try {
      await work();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Connection failed. Try again.");
      setFieldError(error instanceof AiCredentialError ? error.field : undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await act(() => saveAiCredential(provider.id, values))) {
      setValues({});
      setEditing(false);
    }
  };
  const toggleForm = () => {
    setValues({});
    setEditing(!editing);
    setError("");
    setFieldError(undefined);
  };
  return (
    <Card id={openrouter ? "settings-openrouter-card" : prefix} data-status={status}>
      <Row
        icon={
          <IconTile>
            <KeyRoundIcon className="size-4" />
          </IconTile>
        }
        title={provider.label}
        description={
          <span id={`${prefix}-status`}>
            {connectionDescription(status, credential, openrouter, query.error?.message)}
            {provider.capabilities?.tools === false &&
              " Chat-only: use Ask mode; editing requires a model with tools."}
          </span>
        }
      >
        {query.error && (
          <SettingsButton onClick={() => void query.refetch()}>Try again</SettingsButton>
        )}
        <ProviderActions
          status={status}
          connected={!!credential?.connected}
          openrouter={openrouter}
          oauth={provider.oauth}
          prefix={prefix}
          busy={busy}
          editing={editing}
          onToggle={toggleForm}
          onConnect={() => void act(() => connectOpenRouter("/settings/agents"))}
          onDisconnect={() =>
            void act(async () => {
              await disconnectAiProvider(provider.id);
              setValues({});
              setEditing(false);
            })
          }
        />
      </Row>
      {editing && (
        <form className="flex flex-col gap-3 py-3.5" onSubmit={(event) => void submit(event)}>
          {provider.fields.map((field) => (
            <CredentialField
              key={field.name}
              field={field}
              prefix={prefix}
              openrouter={openrouter}
              value={values[field.name] || ""}
              busy={busy}
              error={fieldError === field.name ? error : ""}
              onChange={(value) => setValues({ ...values, [field.name]: value })}
            />
          ))}
          <div>
            <SettingsButton id={`${prefix}-save`} type="submit" disabled={busy}>
              {busy ? "Checking…" : "Save key"}
            </SettingsButton>
          </div>
        </form>
      )}
      {error && !provider.fields.some((field) => field.name === fieldError) && (
        <p id={`${prefix}-error`} role="alert" className="m-0 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <ProviderDefaultModel provider={provider} scope={scope} />
      {openrouter && (
        <Row title="AI setup" description="Connect your AI provider and see what runs where.">
          <SettingsButton
            id="settings-ai-setup"
            onClick={() => window.dispatchEvent(new Event("bd:open-onboarding"))}
          >
            Open setup
          </SettingsButton>
        </Row>
      )}
    </Card>
  );
}

function connectionDescription(
  status: string,
  credential: OpenRouterCredential | undefined,
  openrouter: boolean,
  error?: string,
) {
  if (status === "signed-out") return "Sign in to connect a provider.";
  if (status === "loading") return "Checking…";
  if (status === "error") return error;
  if (status === "server")
    return "Using the server's shared credential. Connect your own to use your credits.";
  if (!credential?.connected) return "Not connected. Add your credentials to use these models.";
  if (openrouter) return describe(credential);
  return ["Connected", credential.last4 && `Key ending ${credential.last4}`, credential.label]
    .filter(Boolean)
    .join(" · ");
}

function CredentialField({
  field,
  prefix,
  openrouter,
  value,
  busy,
  error,
  onChange,
}: {
  field: AiProvider["fields"][number];
  prefix: string;
  openrouter: boolean;
  value: string;
  busy: boolean;
  error: string;
  onChange: (value: string) => void;
}) {
  const id = openrouter && field.name === "apiKey" ? `${prefix}-key` : `${prefix}-${field.name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-foreground">
        {field.label}
        {!field.required && " (optional)"}
      </label>
      <TextField
        id={id}
        name={id}
        type={field.secret ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        required={field.required}
        placeholder={field.placeholder}
        value={value}
        disabled={busy}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : field.help ? `${id}-help` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.help && (
        <span id={`${id}-help`} className="text-xs text-muted-foreground">
          {field.help}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

function ProviderDefaultModel({
  provider,
  scope,
}: {
  provider: AiProvider;
  scope: AccountScope | null;
}) {
  const preferred = useAiDefaultModel(scope, provider.id);
  if (!provider.models.length) return null;
  return (
    <Row title="Default model" description="Used for new turns with this provider's default.">
      <NativeSelect
        aria-label={`${provider.label} default model`}
        disabled={!scope}
        value={preferred || ""}
        onChange={(event) => {
          if (scope) setAiDefaultModel(scope, provider.id, event.target.value);
        }}
      >
        <option value="">
          Server default
          {provider.defaultModel
            ? ` (${provider.models.find((model) => model.id === provider.defaultModel)?.label || provider.defaultModel})`
            : ""}
        </option>
        {provider.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
            {!model.tools ? " · Chat-only" : ""}
          </option>
        ))}
      </NativeSelect>
    </Row>
  );
}

function connectionStatus(
  scope: AccountScope | null,
  pending: boolean,
  failed: boolean,
  credential: OpenRouterCredential | undefined,
  provider: AiProvider,
) {
  if (!scope) return "signed-out";
  if (pending) return "loading";
  if (failed) return "error";
  return credential?.connected ? "connected" : provider.connected;
}

function ProviderActions({
  status,
  connected,
  openrouter,
  oauth,
  prefix,
  busy,
  editing,
  onToggle,
  onConnect,
  onDisconnect,
}: {
  status: string;
  connected: boolean;
  openrouter: boolean;
  oauth: boolean;
  prefix: string;
  busy: boolean;
  editing: boolean;
  onToggle: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (status === "signed-out") return <SettingsButton onClick={openSignIn}>Sign in</SettingsButton>;
  if (status === "loading" || status === "error") return null;
  return (
    <>
      {connected && (
        <SettingsButton
          id={`${prefix}-disconnect`}
          disabled={busy}
          variant="ghost"
          onClick={onDisconnect}
        >
          Disconnect
        </SettingsButton>
      )}
      <SettingsButton
        id={openrouter ? `${prefix}-paste` : `${prefix}-connect`}
        disabled={busy}
        aria-expanded={editing}
        onClick={onToggle}
      >
        {connected ? "Replace" : openrouter ? "Paste API key" : "Connect"}
      </SettingsButton>
      {openrouter && oauth && (
        <SettingsButton
          id={`${prefix}-${connected ? "reconnect" : "connect"}`}
          disabled={busy}
          onClick={onConnect}
        >
          {connected ? "Reconnect" : "Connect OpenRouter"}
        </SettingsButton>
      )}
    </>
  );
}
