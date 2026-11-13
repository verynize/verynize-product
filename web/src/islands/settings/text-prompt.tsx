// The one-line text prompt behind `window.askText(title, value)` (file and folder names, variable names, repository
// URLs, …), a shadcn Dialog rendered by this island. Ids are kept for tests: #text-prompt (the dialog content, present
// only while open), #text-prompt-label, #text-prompt-input, #text-prompt-ok. Resolves the entered text on Continue
// (Enter) and null on Cancel, Escape or a click outside; a call while a prompt is open resolves null at once.
import { useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Request = {
  id: number;
  title: string;
  value: string;
  resolve: (value: string | null) => void;
};

let current: Request | null = null;
let asked = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function askText(title: string, value = ""): Promise<string | null> {
  if (current) return Promise.resolve(null);
  return new Promise((resolve) => {
    current = { id: ++asked, title: String(title), value: String(value ?? ""), resolve };
    emit();
  });
}

function settle(result: string | null) {
  const request = current;
  if (!request) return;
  current = null;
  emit();
  request.resolve(result);
}

// Registered when the UI bundle runs, before the islands mount; a prompt asked before the first render opens with it.
window.askText = askText;

export function TextPrompt() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const input = useRef<HTMLInputElement>(null);

  return (
    // One Dialog per prompt: a prompt asked while the previous one is still animating closed gets a fresh dialog
    // instead of reopening (and being closed by) the exiting one.
    <Dialog key={request?.id ?? 0} open={!!request} onOpenChange={(open) => !open && settle(null)}>
      <DialogContent
        id="text-prompt"
        // Opened from menus: the menu returning focus to its trigger must not dismiss it (a click outside or
        // Escape still does).
        onFocusOutside={(event) => event.preventDefault()}
        className="max-w-sm sm:max-w-sm"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            settle(input.current?.value ?? "");
          }}
        >
          <DialogTitle asChild>
            <label id="text-prompt-label" htmlFor="text-prompt-input" className="m-0">
              {request?.title}
            </label>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enter a value and press Continue.
          </DialogDescription>
          <Input
            id="text-prompt-input"
            ref={input}
            autoComplete="off"
            defaultValue={request?.value}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button type="submit" id="text-prompt-ok">
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
