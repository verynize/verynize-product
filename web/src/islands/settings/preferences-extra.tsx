// Preferences › Notifications sound row (built-in sounds or the user's MP3) and the Advanced section (Wonder 70, 78).
// Element ids / data-pref attributes are test contracts (tests/settings.cjs).
import { PlayIcon } from "lucide-react";
import { toast } from "sonner";
import type { Preferences } from "./api";
import { Card, NativeSelect, Row, Section, SettingsButton, Toggle } from "./controls";
import { appPreferencesApi, playSound, resetCustomSound } from "./preference-runtime";

type Props = { preferences: Preferences; setPreference: (changes: Partial<Preferences>) => void };

const SOUNDS: { value: Preferences["sound"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "chime", label: "Chime" },
  { value: "bell", label: "Bell" },
  { value: "marimba", label: "Marimba" },
  { value: "crystal", label: "Crystal" },
  { value: "rise", label: "Rise" },
  { value: "droplet", label: "Droplet" },
  { value: "pop", label: "Pop" },
];
const CHOOSE = "choose-mp3";

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );

export function ChatSoundRow({ preferences, setPreference }: Props) {
  const api = appPreferencesApi();
  const sound = preferences.sound || "none";
  const choose = async () => {
    if (!api) return;
    try {
      const picked = await api.chooseSound();
      if (!picked) return;
      resetCustomSound();
      setPreference({ sound: "custom", customSoundName: picked.name });
      void playSound("custom");
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <Row
      title="When a chat finishes"
      description="Choose a sound, or use your own MP3."
      htmlFor="settings-sound"
    >
      <div className="flex items-center gap-1.5">
        <SettingsButton
          variant="ghost"
          id="settings-sound-preview"
          aria-label="Play sound"
          title="Play sound"
          className="w-7 px-0"
          disabled={sound === "none"}
          onClick={() => void playSound(sound)}
        >
          <PlayIcon />
        </SettingsButton>
        <NativeSelect
          id="settings-sound"
          data-pref="sound"
          value={sound}
          onChange={(event) => {
            const value = event.target.value;
            if (value === CHOOSE) {
              void choose();
              return;
            }
            setPreference({ sound: value as Preferences["sound"] });
            void playSound(value);
          }}
        >
          {SOUNDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {(preferences.customSoundName || sound === "custom") && (
            <option value="custom">{preferences.customSoundName || "Custom MP3"}</option>
          )}
          <option value={CHOOSE} disabled={!api}>
            Choose an MP3 file…
          </option>
        </NativeSelect>
      </div>
    </Row>
  );
}

type AdvancedKey =
  | "chatTabs"
  | "lineChanges"
  | "openLinksInApp"
  | "attachSelection"
  | "openPullRequest";
const ADVANCED: { key: AdvancedKey; title: string; description: string; fallback: boolean }[] = [
  {
    key: "chatTabs",
    title: "Chat tabs",
    description: "Open several chats in a worktree as tabs.",
    fallback: false,
  },
  {
    key: "lineChanges",
    title: "Line changes in sidebar",
    description: "Show lines added and removed per worktree.",
    fallback: false,
  },
  {
    key: "openLinksInApp",
    title: "Open Verynize links in the desktop app",
    description: "Design links open in the app when it’s installed.",
    fallback: true,
  },
  {
    key: "attachSelection",
    title: "Attach selection to chat",
    description: "What you select on the canvas is added to your message.",
    fallback: true,
  },
  {
    key: "openPullRequest",
    title: "Open the side panel on the pull request",
    description: "Show the pull request instead of its changes.",
    fallback: false,
  },
];

export function AdvancedSection({ preferences, setPreference }: Props) {
  return (
    <Section id="settings-advanced" title="Advanced">
      <Card>
        {ADVANCED.map((item) => (
          <Row key={item.key} title={item.title} description={item.description}>
            <Toggle
              aria-label={item.title}
              data-pref={item.key}
              checked={
                typeof preferences[item.key] === "boolean" ? preferences[item.key] : item.fallback
              }
              onCheckedChange={(checked) => setPreference({ [item.key]: checked })}
            />
          </Row>
        ))}
      </Card>
    </Section>
  );
}
