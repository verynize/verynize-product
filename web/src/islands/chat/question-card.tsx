// Structured question from the agent (ask_user): header chips, the question, option rows (single or multi select),
// a free-text "Other" answer and Submit. Keys: 1–9 pick an option of the active question, Enter submits.
// Once answered the card collapses to a compact "question → answer" summary.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { ChatActionButton, ChatOptionButton } from "./controls";
import { hook, stateHook } from "./hooks";
import type { ChatPart, ChatQuestion } from "./store";

type Draft = { picked: string[]; other: string; otherOn: boolean };
const empty = (): Draft => ({ picked: [], other: "", otherOn: false });

function answerOf(question: ChatQuestion, draft: Draft): string {
  const values = [...draft.picked];
  if (draft.otherOn && draft.other.trim()) values.push(draft.other.trim());
  return question.multiSelect ? values.join(", ") : (values.at(-1) ?? "");
}

function Answered({ part }: { part: ChatPart }) {
  const questions = part.questions ?? [];
  return (
    <div className={cn(hook.question, stateHook("answered"))}>
      <Card>
        <CardContent>
          <div className="flex flex-col gap-1.5 text-sm leading-5">
            {questions.map((q) => (
              <div key={q.id} className="flex min-w-0 flex-col">
                <span className="truncate text-muted-foreground">{q.header || q.question}</span>
                <span className="flex min-w-0 items-start gap-1.5 text-foreground-2">
                  <CheckIcon className="mt-0.75 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{part.answers?.[q.id] || "No answer"}</span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function QuestionCard({
  part,
  onSubmit,
}: {
  part: ChatPart;
  /** Absent when the workspace cannot answer (card is shown read-only). */
  onSubmit?: (answers: Record<string, string>) => void;
}) {
  const questions = part.questions ?? [];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [active, setActive] = useState(0);
  const [sent, setSent] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const uid = useId();

  // Take focus when the card appears, unless the user is typing elsewhere.
  useEffect(() => {
    const focused = document.activeElement;
    if (onSubmit && (!focused || focused === document.body))
      card.current?.focus({ preventScroll: true });
  }, [onSubmit]);

  if (part.answers) return <Answered part={part} />;
  const closed = !onSubmit || sent || (part.state !== undefined && part.state !== "pending");

  const draftOf = (q: ChatQuestion) => drafts[q.id] ?? empty();
  const update = (q: ChatQuestion, next: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [q.id]: { ...(all[q.id] ?? empty()), ...next } }));
  const toggle = (q: ChatQuestion, label: string, qi: number) => {
    const d = draftOf(q);
    if (q.multiSelect)
      update(q, {
        picked: d.picked.includes(label)
          ? d.picked.filter((v) => v !== label)
          : [...d.picked, label],
      });
    else {
      update(q, { picked: [label], otherOn: false });
      if (qi < questions.length - 1) setActive(qi + 1);
    }
  };
  const answers = Object.fromEntries(questions.map((q) => [q.id, answerOf(q, draftOf(q))]));
  const complete = questions.every((q) => answers[q.id]);
  const submit = () => {
    if (closed || !complete) return;
    setSent(true);
    onSubmit?.(answers);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (closed) return;
    const inText = (event.target as HTMLElement).tagName === "INPUT";
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (inText || event.metaKey || event.ctrlKey || event.altKey) return;
    const n = Number.parseInt(event.key, 10);
    const q = questions[active];
    const options = q?.options ?? [];
    if (q && n >= 1 && n <= 9) {
      event.preventDefault();
      if (n <= options.length) toggle(q, options[n - 1].label, active);
      else if (n === options.length + 1) {
        update(q, { otherOn: true, picked: q.multiSelect ? draftOf(q).picked : [] });
        requestAnimationFrame(() => document.getElementById(`${uid}-other-${active}`)?.focus());
      }
    }
  };

  return (
    // The hook classes, focus target and keyboard handler live on a wrapper; the Card draws the surface.
    <div
      ref={card}
      tabIndex={-1}
      role="group"
      aria-label="Question from the agent"
      onKeyDown={onKeyDown}
      className={cn(
        hook.question,
        stateHook(closed ? "closed" : "pending"),
        "m-0 rounded-xl outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <Card>
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <MessageCircleQuestionIcon className="size-3.5 text-primary-text" />
              {questions.length > 1 ? `${questions.length} questions` : "Question"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-base leading-5.25">
            {questions.map((q, qi) => {
              const d = draftOf(q);
              const options = q.options ?? [];
              const role = q.multiSelect ? "checkbox" : "radio";
              return (
                <fieldset
                  key={q.id}
                  disabled={closed}
                  onFocus={() => setActive(qi)}
                  className={cn(
                    "m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0",
                    qi > 0 && "border-t border-card-border pt-3",
                  )}
                >
                  {q.header && (
                    <span className="flex">
                      <span className="flex h-5 items-center rounded-md border border-chat-chip-border bg-chat-chip-bg px-1.5 text-xs text-foreground-3">
                        {q.header}
                      </span>
                    </span>
                  )}
                  <legend className="float-left w-full p-0 break-words text-foreground">
                    {q.question}
                  </legend>
                  {q.multiSelect && (
                    <span className="text-xs text-subtle-foreground">Select all that apply</span>
                  )}
                  <div
                    role={q.multiSelect ? "group" : "radiogroup"}
                    aria-label={q.question}
                    className="flex flex-col gap-1"
                  >
                    {options.map((option, oi) => {
                      const on = d.picked.includes(option.label);
                      return (
                        <ChatOptionButton
                          key={option.label}
                          role={role}
                          aria-checked={on}
                          selected={on}
                          onClick={() => toggle(q, option.label, qi)}
                          className="w-full"
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-px flex size-4.5 shrink-0 items-center justify-center rounded-sm border text-xs tabular-nums",
                              on
                                ? "border-ring bg-primary text-primary-foreground"
                                : "border-edge text-muted-foreground",
                            )}
                          >
                            {on ? <CheckIcon className="size-3" /> : oi < 9 ? oi + 1 : ""}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="break-words">{option.label}</span>
                            {option.description && (
                              <span className="break-words text-muted-foreground">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </ChatOptionButton>
                      );
                    })}
                    <div
                      onClick={() => document.getElementById(`${uid}-other-${qi}`)?.focus()}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg border px-2.5 text-sm",
                        d.otherOn ? "border-ring bg-settings" : "border-card-border bg-settings",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-4.5 shrink-0 items-center justify-center rounded-sm border border-edge text-xs text-muted-foreground tabular-nums"
                      >
                        {options.length < 9 ? options.length + 1 : ""}
                      </span>
                      {/* Inline field inside the option row (the row draws the border and focus state). */}
                      <input
                        id={`${uid}-other-${qi}`}
                        value={d.other}
                        placeholder={options.length ? "Other…" : "Your answer…"}
                        aria-label={`Other answer: ${q.question}`}
                        onFocus={() =>
                          update(q, { otherOn: true, picked: q.multiSelect ? d.picked : [] })
                        }
                        onChange={(event) =>
                          update(q, { other: event.target.value, otherOn: true })
                        }
                        className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-hidden placeholder:text-subtle-foreground"
                      />
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex w-full items-center justify-end gap-2">
            {!closed && (
              <>
                <span className="mr-auto flex flex-wrap items-center gap-1 text-xs text-subtle-foreground">
                  Press <Kbd>1</Kbd>–<Kbd>9</Kbd> to choose, <Kbd>↵</Kbd> to submit
                </span>
                <ChatActionButton disabled={!complete} onClick={submit}>
                  Submit
                </ChatActionButton>
              </>
            )}
            {closed && !sent && (
              <span className="mr-auto text-xs text-subtle-foreground">
                {onSubmit ? "No longer waiting for an answer" : "Answer from the chat window"}
              </span>
            )}
            {sent && (
              <span className="mr-auto text-xs text-subtle-foreground">Sending answer…</span>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
