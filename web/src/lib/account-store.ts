// The database-backed legacy stores are shared by both application shells.
export {};
declare global {
  interface Window {
    accountStore?: {
      entries(prefix: "file:"): [string, { folder?: string | null; archived?: boolean }][];
      entries(prefix: "preference:behavior."): [string, unknown][];
      put(key: string, value: unknown): void;
      /** A record's full value (e.g. `load("chat:<id>")`); account-store-changed follows. */
      load(key: string): Promise<unknown>;
      ready(): boolean;
      signedIn(): boolean;
      refresh(): Promise<void>;
      flush(): Promise<void>;
      status(): { ready: boolean; pending: number; error: string };
    };
  }
}
