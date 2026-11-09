// Room size limits for the Worker. The values live in web/room-limits.js so the renderer reads
// the same numbers (globalThis.VerynizeRoomLimits).
import "../web/room-limits.js";

const Limits = globalThis.VerynizeRoomLimits;
/** Largest page (its properties and nodes as JSON), in bytes: the full 20 MiB document budget. */
export const PAGE_BYTES = Limits.PAGE_BYTES;
/** Largest document (metadata plus every page), in bytes: 20 MiB, like a desktop file. */
export const DOCUMENT_BYTES = Limits.DOCUMENT_BYTES;
/** Largest document metadata (every top-level field except pages), in bytes: 2 MiB. */
export const META_BYTES = Limits.META_BYTES;
/** Largest whole-document request body (create, PUT snapshot), in bytes. */
export const REQUEST_BYTES = Limits.REQUEST_BYTES;
/** Largest WebSocket message or operation batch, in bytes. */
export const MESSAGE_BYTES = Limits.MESSAGE_BYTES;
/** Largest operation batch of several operations (one operation may reach MESSAGE_BYTES). */
export const BATCH_BYTES = Limits.BATCH_BYTES;
/** Most operations in one batch. */
export const BATCH_OPS = Limits.BATCH_OPS;
/** `code` of a batch refused for exceeding BATCH_BYTES. */
export const BATCH_TOO_LARGE = Limits.BATCH_TOO_LARGE;
/** UTF-8 size of a string, or of a value as JSON. */
export const byteSize = Limits.bytes;
