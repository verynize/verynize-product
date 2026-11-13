import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import { HomeButton } from "./menu";
import { toast } from "sonner";

export type NameRequest = {
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  submit: string;
  onSubmit(value: string): unknown;
};

/** Small single-field dialog used for "Rename file" and "New folder". */
export function NameDialog({
  request,
  onClose,
}: {
  request: NameRequest | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (request) setValue(request.value);
  }, [request]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || !request) return;
    try {
      await request.onSubmit(name);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <DialogPrimitive.Root open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal container={portalContainer()}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 w-90 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-card-border bg-popover p-4 text-sm text-foreground-2 shadow-menu outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          // The legacy shell closes the Files screen on Escape; keep Escape inside the dialog.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
            input.current?.select();
          }}
        >
          <form onSubmit={submit} className="flex flex-col gap-3">
            <DialogPrimitive.Title className="text-sm font-medium text-foreground">
              {request?.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {request?.label}
            </DialogPrimitive.Description>
            <input
              ref={input}
              aria-label={request?.label}
              value={value}
              placeholder={request?.placeholder}
              onChange={(event) => setValue(event.target.value)}
              maxLength={120}
              className="h-8 w-full rounded-md border border-card-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:border-primary"
            />
            <div className="flex justify-end gap-2">
              <DialogPrimitive.Close asChild>
                <HomeButton>Cancel</HomeButton>
              </DialogPrimitive.Close>
              <HomeButton type="submit" variant="primary" disabled={!value.trim()}>
                {request?.submit}
              </HomeButton>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
