// Design preferences (Memory, ref 75), Allowed actions and the tools version (Agents › About).
// Everything here is feature-detected on the desktop preload: the plain web build renders a note.
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, Row, Section, SettingsButton, TextField } from "./controls";
import { platform } from "@/lib/platform";

export type DesignPreference = {
  id: string;
  text: string;
  created?: string | null;
  updated?: string | null;
};
export type PreferencesIpc = {
  list(): Promise<DesignPreference[]>;
  save(text: string): Promise<DesignPreference>;
  update(id: string, text: string): Promise<DesignPreference>;
  remove(id: string): Promise<unknown>;
};
export type AllowRule =
  | string
  | ({
      id?: string;
      label?: string;
      rule?: string;
      pattern?: string;
      tool?: string;
      agent?: string;
      description?: string;
    } & Record<string, unknown>);
const desktop = () => platform.desktop;
export const MAX_PREFERENCE_LENGTH = 280;
/** How many design preferences the runtime keeps (desktop enforces the same limit). */
export const MAX_PREFERENCES = 50;

/** "n / 280" under a preference field; turns to the warning color near the limit. */
function CharCounter({ length, id }: { length: number; id?: string }) {
  const near = length >= MAX_PREFERENCE_LENGTH - 20;
  return (
    <span
      id={id}
      data-preference-counter
      aria-live="polite"
      className={cn(
        "shrink-0 text-xs tabular-nums",
        near ? "text-warning" : "text-subtle-foreground",
      )}
    >
      {length} / {MAX_PREFERENCE_LENGTH}
    </span>
  );
}

export function preferencesIpc(): PreferencesIpc | null {
  const ipc: Partial<PreferencesIpc> | undefined = desktop()?.designPreferences;
  return ipc &&
    (["list", "save", "update", "remove"] as const).every((k) => typeof ipc[k] === "function")
    ? (ipc as PreferencesIpc)
    : null;
}
export const allowRulesAvailable = () => typeof desktop()?.listAllowRules === "function";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ---------- Design preferences ---------- */
export function DesignPreferencesSection() {
  const ipc = preferencesIpc();
  const [items, setItems] = useState<DesignPreference[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!ipc) return;
    try {
      setItems(await ipc.list());
    } catch (error) {
      setItems([]);
      toast(message(error));
    }
  }, [ipc]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (!ipc) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (done) toast(done);
      return true;
    } catch (error) {
      toast(message(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const full = (items?.length ?? 0) >= MAX_PREFERENCES;
  const add = async () => {
    const text = draft.trim();
    if (text && !full && (await run(() => ipc!.save(text), "Design preference saved")))
      setDraft("");
  };
  const commitEdit = async () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    if (await run(() => ipc!.update(editing.id, text), "Design preference updated"))
      setEditing(null);
  };

  return (
    <Section
      id="settings-design-preferences"
      title="Design preferences"
      description="Your taste in visual work: agents weigh these whenever they design for you, and what you ask in a chat takes precedence."
      action={
        ipc &&
        items !== null && (
          <span
            id="settings-design-preference-count"
            data-preference-count
            className="shrink-0 text-sm text-muted-foreground tabular-nums"
          >
            {items.length} / {MAX_PREFERENCES}
          </span>
        )
      }
    >
      {!ipc ? (
        <Card>
          <Row
            title="Available in the desktop app"
            description="Design preferences are stored on this computer by Verynize."
          />
        </Card>
      ) : (
        <Card id="settings-design-preference-list">
          {items !== null && items.length === 0 && (
            <Row
              title="No saved preferences yet"
              description="Note what you like to see, such as “warm off-white backgrounds, never pure white”, or tell an agent to remember it."
            />
          )}
          {(items ?? []).map((pref) =>
            editing?.id === pref.id ? (
              <div
                key={pref.id}
                data-preference-id={pref.id}
                className="flex items-center gap-2 py-3.5"
              >
                <TextField
                  autoFocus
                  aria-label="Edit design preference"
                  aria-describedby="settings-design-preference-edit-counter"
                  data-preference-edit
                  maxLength={MAX_PREFERENCE_LENGTH}
                  className="min-w-0 flex-1"
                  value={editing.text}
                  onChange={(event) => setEditing({ id: pref.id, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitEdit();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      event.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
                <CharCounter
                  id="settings-design-preference-edit-counter"
                  length={editing.text.length}
                />
                <SettingsButton
                  aria-label="Save preference"
                  data-preference-save
                  disabled={busy}
                  onClick={() => void commitEdit()}
                >
                  <CheckIcon />
                </SettingsButton>
                <SettingsButton
                  variant="ghost"
                  aria-label="Cancel editing"
                  onClick={() => setEditing(null)}
                >
                  <XIcon />
                </SettingsButton>
              </div>
            ) : (
              <Row
                key={pref.id}
                title={
                  <span data-preference-id={pref.id} data-preference-text className="break-words">
                    {pref.text}
                  </span>
                }
              >
                <SettingsButton
                  variant="ghost"
                  className="w-7 px-0"
                  aria-label={`Edit “${pref.text}”`}
                  data-preference-action="edit"
                  onClick={() => setEditing({ id: pref.id, text: pref.text })}
                >
                  <PencilIcon />
                </SettingsButton>
                <SettingsButton
                  variant="ghost"
                  className="w-7 px-0"
                  aria-label={`Delete “${pref.text}”`}
                  data-preference-action="delete"
                  disabled={busy}
                  onClick={() => void run(() => ipc.remove(pref.id), "Design preference deleted")}
                >
                  <Trash2Icon />
                </SettingsButton>
              </Row>
            ),
          )}
          <div className="flex items-center gap-2 py-3.5">
            <TextField
              id="settings-design-preference-new"
              aria-label="New design preference"
              aria-describedby="settings-design-preference-new-counter"
              maxLength={MAX_PREFERENCE_LENGTH}
              disabled={full}
              placeholder={
                full
                  ? `All ${MAX_PREFERENCES} spots are used; edit or delete one first`
                  : "Add a taste note, e.g. “Muted earth tones with one bold accent”"
              }
              className="min-w-0 flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void add()}
            />
            <CharCounter id="settings-design-preference-new-counter" length={draft.length} />
            <SettingsButton
              id="settings-design-preference-add"
              disabled={busy || full || !draft.trim()}
              onClick={() => void add()}
            >
              <PlusIcon />
              Add
            </SettingsButton>
          </div>
        </Card>
      )}
    </Section>
  );
}

/* ---------- Allowed actions ---------- */
const ruleLabel = (rule: AllowRule) =>
  typeof rule === "string"
    ? rule
    : String(
        rule.label ?? rule.rule ?? rule.pattern ?? rule.tool ?? rule.id ?? JSON.stringify(rule),
      );
const ruleDetail = (rule: AllowRule) =>
  typeof rule === "string"
    ? undefined
    : [rule.agent, rule.description].filter((v) => typeof v === "string" && v).join(" · ") ||
      undefined;

export function AllowedActionsSection() {
  const [rules, setRules] = useState<AllowRule[] | null>(null);
  const reload = useCallback(async () => {
    const list = desktop()?.listAllowRules;
    if (!list) return;
    try {
      const value = await list();
      setRules(Array.isArray(value) ? value : []);
    } catch (error) {
      setRules([]);
      toast(message(error));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const remove = async (rule: AllowRule) => {
    try {
      await desktop()?.removeAllowRule?.(typeof rule === "string" ? rule : (rule.id ?? rule));
      toast("Permission removed");
    } catch (error) {
      toast(message(error));
    }
    await reload();
  };
  return (
    <Section
      id="settings-allowed-actions"
      title="Always allowed"
      description="Actions you approved with “Always allow” in chat. Remove one to be asked again."
    >
      <Card id="settings-allow-rule-list">
        {rules !== null && rules.length === 0 && (
          <Row
            title="No allowed actions yet"
            description="When an agent asks for permission, choose “Always allow” to skip the question next time."
          />
        )}
        {(rules ?? []).map((rule, i) => (
          <Row
            key={`${ruleLabel(rule)}-${i}`}
            icon={<ShieldCheckIcon className="size-4 shrink-0 text-muted-foreground" />}
            title={
              <span data-allow-rule className="font-mono text-xs break-all">
                {ruleLabel(rule)}
              </span>
            }
            description={ruleDetail(rule)}
          >
            {typeof desktop()?.removeAllowRule === "function" && (
              <SettingsButton data-allow-rule-remove onClick={() => void remove(rule)}>
                Remove
              </SettingsButton>
            )}
          </Row>
        ))}
      </Card>
    </Section>
  );
}

/* ---------- Tools version (pushed by desktop/mcp-bridge.cjs through web/agent-bridge.js) ---------- */
type ToolsInfo = { toolsVersion: string | null; serverVersion: string | null };
const toolsInfo = () => (window as unknown as { verynizeTools?: ToolsInfo }).verynizeTools ?? null;

export function useToolsInfo() {
  const [info, setInfo] = useState<ToolsInfo | null>(toolsInfo);
  useEffect(() => {
    const update = () => setInfo(toolsInfo());
    window.addEventListener("verynize-tools", update);
    update();
    return () => window.removeEventListener("verynize-tools", update);
  }, []);
  return info;
}
