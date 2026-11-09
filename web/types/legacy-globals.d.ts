// Classic scripts retain their runtime ownership and loading order. Reuse the island declarations
// for shared globals instead of declaring competing versions of design, preferences and accounts.
import "../src/lib/bridge";
import "../src/lib/platform";
import "../src/lib/cloud-account";
import "../src/lib/account-store";
import "../src/lib/image-upload";
import type { DesktopApi } from "../src/lib/desktop-api";
import type {
  CloudState,
  RoomAccess,
  InviteRole,
  InviteResult,
  Visibility,
} from "../src/islands/share/api";
export interface CloudRoom {
  server: string;
  id: string;
  fileId: string;
}
export interface CloudWorkspace {
  room(): CloudRoom | null;
  isConnected(): boolean;
  disconnect(): void;
  role(): string | null;
  openDialog(): void;
  server(): string;
  hasSession(server: string): boolean;
  pendingCount(): number;
  request(path: string, options?: RequestInit): Promise<unknown>;
  openRoom(info: {
    server: string;
    id: string;
    token?: string;
    anonymous?: boolean;
    switchToken?: string;
  }): Promise<unknown>;
  ensureRoom(): Promise<{ server: string; roomId: string }>;
  access(): Promise<RoomAccess | null>;
  setVisibility(visibility: Visibility): Promise<Visibility>;
  invite(emails: string[], role: InviteRole): Promise<InviteResult>;
  shareLink(): string;
  state(): CloudState;
}
declare global {
  interface Window {
    desktop?: DesktopApi;
    cloudHistory: {
      active(): boolean;
      canUndo(): boolean;
      canRedo(): boolean;
      undo(): boolean;
      redo(): boolean;
    };
    switchCache: {
      key(info: { server: string; id: string }): string;
      trustLocal(document: object): void;
      isTrustedLocal(document: object): boolean;
      put(id: string, document: object, meta?: Record<string, unknown>): void;
      get(id: string): (Record<string, unknown> & { document: object; bytes: number }) | null;
      remove(id: string): void;
      clear(): void;
      stats(): {
        entries: number;
        bytes: number;
        hits: number;
        localHits: number;
        evictions: number;
        maxFiles: number;
        maxBytes: number;
      };
    };
    cloudWorkspace: CloudWorkspace;
    embeddedFontCss(markup?: string): string;
    sanitizeSvg(source: string): Element | null;
    previewTabTarget(): string | null;
    webCapture: { open(): void };
    verynizeTools: Readonly<{ toolsVersion: string; serverVersion: string }>;
    /** web/document-core.js; only the world-bounds helpers are typed. */
    VerynizeDocument: {
      pageWorldBounds(
        page: object,
        measuredRects?: Map<string, { x: number; y: number; w: number; h: number }>,
      ): {
        /** Absolute world rectangle of every node, by id. */
        rects: Map<string, { x: number; y: number; w: number; h: number }>;
        bounds: { x: number; y: number; w: number; h: number } | null;
        outOfRange: boolean;
        advisory: boolean;
      };
      validateWorldBoundsChange(before: object, after: object): void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/src/lib/router/shell-router.ts; untyped from the legacy side. */
    shellNavigation?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/shell-request.js */
    shellRequest: ((target: unknown, apply?: () => void) => unknown) & { pending: unknown[] };
    /** web/switch-coordinator.js */
    switchCoordinator: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/remote-apply.js: collaborators' edits patched in node by node. */
    remoteApply: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/commit-state.js: deeply frozen commit snapshots and patch-based history entries. */
    VerynizeCommitState: Readonly<{
      freeze<T>(value: T): T;
      same(a: unknown, b: unknown): boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      diff(before: unknown, after: unknown, path?: unknown[], out?: unknown[]): any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      compact(entry: any, current: any): any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      apply(entry: any, current: any): any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      store(): any;
    }>;
    /** web/commit-validation.js: validation of a commit, limited to what changed. */
    VerynizeCommitValidation: Readonly<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      world(before: any, after: any, old: any, targets?: any): void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      schema(before: any, document: any, old: any, targets?: any): void;
      remember(snapshot: object): void;
    }>;
    /** web/lazy-document.js */
    VerynizeLazyDocument: Readonly<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      activate(document: any): any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      prepare(document: any, defaults?: any, repairs?: any): any;
      match(next: object, live: object): void;
    }>;
    /** web/library-storage.js: the file library in IndexedDB. */
    VerynizeLibraryStorage: Readonly<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      create(onError?: (error: unknown) => void, databaseName?: string): any;
    }>;
    /** web/selection-bounds.js */
    VerynizeSelectionBounds: Readonly<{
      rects(
        nodes: object[],
        elementOf?: (id: string) => HTMLElement | null,
      ): Map<string, { x: number; y: number; w: number; h: number }>;
    }>;
    /** web/asset-store.js: content-addressed `asset:<sha256>` image bytes. */
    assetStore: {
      put(blob: Blob, expectedRef?: string): Promise<string>;
      get(ref: string): Promise<Blob>;
      inlineMarkup(markup: string): Promise<string>;
      resolve(ref: string): string;
      css(value: unknown): string;
      style(style: [string, unknown][]): [string, string][];
    };
    /** web/component-core.js */
    VerynizeComponents: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/node-index.js */
    VerynizeNodeIndex: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
    /** web/document-safety.js; only the world-bounds notices are typed. */
    documentSafety: {
      worldBounds(page: object, recenter: () => void): void;
      editRejected(message: string): void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy API
      [key: string]: any;
    };
  }
}
