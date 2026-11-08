// Behaviour upgrades for the legacy <dialog>s this island restyles (see settings.css):
// accessible names, icon close buttons, focus on open, and toasts for export results.
import { useEffect } from "react";
import { toast } from "sonner";
import { legacy } from "@/lib/bridge";

/** Dialog id → heading element id (`title`) or accessible name (`label`), and its close button id. */
const DIALOGS: Record<string, { title?: string; label?: string; close?: string }> = {
  "cloud-dialog": { label: "Share", close: "cloud-close" },
};

function labelDialogs() {
  for (const [id, info] of Object.entries(DIALOGS)) {
    const dialog = document.getElementById(id);
    if (!dialog) continue;
    dialog.dataset.bdDialog = "settings";
    if (info.title) dialog.setAttribute("aria-labelledby", info.title);
    else if (info.label && !dialog.hasAttribute("aria-label"))
      dialog.setAttribute("aria-label", info.label);
    const close = info.close && document.getElementById(info.close);
    if (close) {
      close.setAttribute("aria-label", "Close");
      close.setAttribute("title", "Close");
      close.classList.add("bd-dialog-close");
    }
  }
  // Primary actions get the purple button treatment.
  for (const id of ["cloud-create"]) document.getElementById(id)?.classList.add("bd-primary");
  // Cloud share: group the room actions so the panel reads like Wonder's share popover.
  const publicLink = document.getElementById("cloud-public");
  if (publicLink && !publicLink.textContent) publicLink.hidden = true;
}

/** Focus the first field when a dialog opens (native showModal focuses the first button, usually Close). */
function focusFirstField(dialog: HTMLDialogElement) {
  const field = dialog.querySelector<HTMLElement>(
    "input:not([type=hidden]):not([type=file]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [data-template]",
  );
  if (field) field.focus();
}

export function DialogEnhancer() {
  useEffect(() => {
    labelDialogs();
    const observers: MutationObserver[] = [];
    for (const id of Object.keys(DIALOGS)) {
      const dialog = document.getElementById(id) as HTMLDialogElement | null;
      if (!dialog) continue;
      const observer = new MutationObserver(() => {
        if (dialog.open) {
          labelDialogs();
          if (
            !dialog.contains(document.activeElement) ||
            document.activeElement?.classList.contains("bd-dialog-close")
          )
            focusFirstField(dialog);
        }
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
      observers.push(observer);
    }
    // Hide the public link until it has content (cloud-panel sets text when a snapshot is published).
    const link = document.getElementById("cloud-public");
    if (link) {
      const observer = new MutationObserver(() => {
        link.hidden = !link.textContent;
      });
      observer.observe(link, { childList: true, characterData: true, subtree: true });
      observers.push(observer);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);
  return null;
}

/** Export result toast (ref 50: "Exported 1 element"). Mirrors `#artwork-status`, which the inspector island owns. */
export function ExportToasts() {
  useEffect(() => {
    let observed: HTMLElement | null = null;
    // Every assignment replaces the text node, so repeated identical results still produce a mutation.
    const observer = new MutationObserver(() => {
      const text = observed?.textContent?.trim() ?? "";
      if (!text) return;
      if (/^Exported/i.test(text)) toast.success(text);
      else if (!/^Exporting/i.test(text)) toast.error(text);
    });
    const attach = () => {
      const el = legacy("artwork-status");
      if (!el || el === observed) return;
      observer.disconnect();
      observed = el;
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    };
    attach();
    // Another island may take over / move the element after we mount.
    const timer = window.setInterval(attach, 2000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
