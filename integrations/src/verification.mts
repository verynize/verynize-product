// Revision-bound verification receipts and the finish gate. A receipt records that an artboard
// was screenshotted, linted and reviewed at one document revision; any mutation invalidates it.
// finishGate decides whether finish_artboard may report "verified", must report "unverified",
// or is blocked by critical lint problems. Repairs are capped per artboard (MAX_REPAIRS).

import { randomUUID } from "node:crypto";

export interface LintProblem {
  id: string;
  severity: string;
  rule?: string;
  ref?: string | null;
  message?: string;
  fix?: string;
  [detail: string]: unknown;
}
export interface LintResult {
  problems: LintProblem[];
  stats?: { critical?: number; major?: number; minor?: number; geometry?: string };
}
export interface Screenshot {
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  source?: string;
}
export interface ReceiptInput {
  documentRevision: string;
  pageId?: string | null;
  artboardId: string;
  screenshot?: Screenshot | null;
  lint?: LintResult | null;
  reviewNote?: unknown;
}
export type VerificationReceipt = ReturnType<typeof createReceipt>;
export interface RepairBudget {
  used: number;
  max: number;
  remaining: number;
  exhausted: boolean;
}
export interface FinishInput {
  receipt?: VerificationReceipt | null;
  currentRevision?: string;
  lint?: LintResult | null;
  budget?: RepairBudget | null;
  artboardId?: string;
}
export type FinishResult = {
  reasons: string[];
  critical: ({ id: string } & Partial<LintProblem>)[];
} & (
  | { status: "blocked"; allowFinish: false }
  | { status: "unverified" | "verified"; allowFinish: true }
);
type DocumentKey = string | null | undefined;

export const MAX_REPAIRS = 3;
const ESTIMATED_SOURCE = /headless|estimat|unavailable|none|fallback/i;

const compactLint = (lint: LintResult | null) =>
  lint
    ? {
        critical: lint.problems.filter((p) => p.severity === "critical").map((p) => p.id),
        counts: {
          critical: lint.stats?.critical ?? 0,
          major: lint.stats?.major ?? 0,
          minor: lint.stats?.minor ?? 0,
        },
        geometry: lint.stats?.geometry,
      }
    : null;

/** Build an immutable receipt. `lint` is a lintArtboard() result (stored compactly). */
export function createReceipt({
  documentRevision,
  pageId,
  artboardId,
  screenshot = null,
  lint = null,
  reviewNote = "",
}: ReceiptInput) {
  if (!documentRevision || !artboardId)
    throw new Error("A receipt needs documentRevision and artboardId");
  return Object.freeze({
    id: randomUUID(),
    documentRevision,
    pageId: pageId ?? null,
    artboardId,
    screenshot: screenshot
      ? Object.freeze({
          sha256: screenshot.sha256 || null,
          width: screenshot.width ?? null,
          height: screenshot.height ?? null,
          source: screenshot.source || "unknown",
        })
      : null,
    lint: compactLint(lint),
    reviewNote: typeof reviewNote === "string" ? reviewNote.trim() : "",
    createdAt: new Date().toISOString(),
  });
}

const screenshotReal = (shot: Screenshot | null) =>
  !!(shot && shot.sha256 && !ESTIMATED_SOURCE.test(shot.source || ""));
/** A receipt is valid when it matches the current revision and holds a real screenshot. */
export const isReceiptValid = (
  receipt: VerificationReceipt | null | undefined,
  currentRevision: string | undefined,
) =>
  !!receipt && receipt.documentRevision === currentRevision && screenshotReal(receipt.screenshot);

const keyOf = (document: DocumentKey, artboardId: string | null) =>
  `${document ?? ""}\u0000${artboardId}`;

/** In-memory receipts and repair counters keyed by (document name, artboard id). */
export class ReceiptStore {
  #receipts = new Map<string, VerificationReceipt>();
  #repairs = new Map<string, number>();
  record(document: DocumentKey, receipt: VerificationReceipt) {
    this.#receipts.set(keyOf(document, receipt.artboardId), receipt);
    return receipt;
  }
  latest(document: DocumentKey, artboardId: string) {
    return this.#receipts.get(keyOf(document, artboardId)) || null;
  }
  /** Call on every mutation. With an artboardId, an edit after a receipt counts as one repair iteration. */
  invalidate(document: DocumentKey, artboardId?: string | null) {
    if (artboardId !== undefined && artboardId !== null) {
      const key = keyOf(document, artboardId);
      if (this.#receipts.delete(key)) this.#repairs.set(key, (this.#repairs.get(key) || 0) + 1);
      return;
    }
    const prefix = `${document ?? ""}\u0000`;
    for (const key of this.#receipts.keys()) if (key.startsWith(prefix)) this.#receipts.delete(key);
  }
  recordRepair(document: DocumentKey, artboardId: string) {
    const key = keyOf(document, artboardId);
    this.#repairs.set(key, (this.#repairs.get(key) || 0) + 1);
    return this.repairBudget(document, artboardId);
  }
  repairBudget(document: DocumentKey, artboardId: string, max = MAX_REPAIRS): RepairBudget {
    const used = this.#repairs.get(keyOf(document, artboardId)) || 0;
    return { used, max, remaining: Math.max(0, max - used), exhausted: used >= max };
  }
  /** Forget receipts and repair counts (artboard deleted or recreated). */
  reset(document: DocumentKey, artboardId?: string) {
    const match =
      artboardId === undefined
        ? (key: string) => key.startsWith(`${document ?? ""}\u0000`)
        : (key: string) => key === keyOf(document, artboardId);
    for (const map of [this.#receipts, this.#repairs])
      for (const key of map.keys()) if (match(key)) map.delete(key);
  }
}

/**
 * Decide the finish status. `lint` is the current lintArtboard() result (falls back to the receipt's);
 * `budget` is ReceiptStore#repairBudget(). Returns {status, reasons, allowFinish, critical}.
 */
export function finishGate({
  receipt,
  currentRevision,
  lint,
  budget = null,
  artboardId,
}: FinishInput = {}): FinishResult {
  const reasons = [];
  const critical = lint
    ? lint.problems.filter((p) => p.severity === "critical")
    : (receipt?.lint?.critical || []).map((id) => ({ id }));
  if (!receipt)
    reasons.push("no verification receipt: take a screenshot and record a design review first");
  else {
    if (artboardId && receipt.artboardId !== artboardId)
      reasons.push(`receipt belongs to artboard ${receipt.artboardId}`);
    if (receipt.documentRevision !== currentRevision)
      reasons.push("stale receipt: the document changed after the last screenshot");
    if (!receipt.screenshot?.sha256) reasons.push("screenshot unavailable");
    else if (ESTIMATED_SOURCE.test(receipt.screenshot.source || ""))
      reasons.push(`screenshot is not a real render (source: ${receipt.screenshot.source})`);
    if (!receipt.reviewNote) reasons.push("no design-review note recorded");
  }
  const exhausted = !!budget?.exhausted;
  if (critical.length) {
    const list = `${critical.length} critical lint problem${critical.length > 1 ? "s" : ""} unresolved (${critical
      .map((p) => p.id)
      .slice(0, 10)
      .join(", ")})`;
    if (!exhausted)
      return { status: "blocked", reasons: [list, ...reasons], allowFinish: false, critical };
    return {
      status: "unverified",
      reasons: ["repair budget exhausted", list, ...reasons],
      allowFinish: true,
      critical,
    };
  }
  if (reasons.length)
    return {
      status: "unverified",
      reasons: exhausted ? ["repair budget exhausted", ...reasons] : reasons,
      allowFinish: true,
      critical,
    };
  return { status: "verified", reasons: [], allowFinish: true, critical };
}
