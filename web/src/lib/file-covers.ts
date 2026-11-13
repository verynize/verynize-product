import type { DesignDocument } from "./bridge";

/** The parts of a Home file (`LibraryFile`) a cover needs. */
export interface CoverFile {
  id: string;
  document: DesignDocument;
  cloud?: { server: string; roomId: string; detached?: boolean } | null;
  room?: { server: string; id: string };
}

/** A room's uploaded cover (`GET|PUT /api/rooms/:id/thumbnail`, cloud/README.md). */
export interface FileCoverMeta {
  url: string;
  nodeId: string | null;
  pageId: string | null;
  sha256: string;
  contentType: string;
  size: number;
  updatedAt: number;
}

/** A displayable file cover: uploaded (signed URL) or rendered locally (data URL). */
export interface FileCover {
  url: string;
  nodeId: string | null;
  pageId?: string | null;
}

declare global {
  interface Window {
    /** web/file-thumbnails.js: file covers for Home cards and their cloud upload. */
    fileThumbnails: {
      cached(file: CoverFile): FileCover | null;
      load(file: CoverFile): Promise<FileCover | null>;
      local(file: CoverFile): Promise<FileCover | null>;
      refresh(): Promise<void>;
      render(id?: string | null, doc?: DesignDocument): Promise<string>;
      status(): { uploading: boolean; lastError: string };
    };
  }
}
