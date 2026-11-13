"use strict";
(() => {
  const MAX_BYTES = 8_000_000,
    OUTPUT_BYTES = 2_000_000,
    MAX_SIDE = 4096;
  const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
  let queue = Promise.resolve();
  const cache = new Map();
  function batch(files) {
    if (files.length > 20 || [...files].reduce((n, f) => n + f.size, 0) > 40_000_000)
      throw Error("Choose at most 20 images / 40 MB per batch.");
  }
  // Shared limits measure data URLs as the room assets they become (window.storageLimits);
  // a file saved on this device keeps them inline, so its raw JSON has its own 20 MiB cap
  // (integrations/design-store.mjs). Near a limit the storage island already warns; only a
  // refusal is reported here, and nothing is added to the canvas.
  const LOCAL_LIMIT_BYTES = 20 * 1024 * 1024;
  function refuse(problem) {
    const message = "Image not added: it would exceed the storage limit. " + problem.message;
    window.storageLimits.reportError({ ...problem, level: "over" }, "add image");
    throw Object.assign(Error(message), { code: "storage_limit", reported: true });
  }
  function preflight(doc) {
    const limits = window.storageLimits;
    const over = limits.problems(limits.measure(doc)).find((p) => p.level === "over");
    if (over) refuse(over);
    const bytes = limits.utf8Length(JSON.stringify(doc));
    if (bytes > LOCAL_LIMIT_BYTES)
      refuse({
        scope: "document",
        bytes,
        limit: LOCAL_LIMIT_BYTES,
        message: `This file would be ${(bytes / 1048576).toFixed(1)} MB, over the 20 MB limit for files saved on this device. Remove large images or split it into several files.`,
      });
  }
  // Existing oversized documents must still permit edits that do not add image bytes. `before`/`after` are what
  // changed (the whole document by default, or only the edited nodes): `doc` is checked when `after` adds images.
  function preflightChange(doc, before, after = doc) {
    const sources = (value) => {
      const counts = new Map();
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "string" && item.startsWith("data:image/"))
          counts.set(item, (counts.get(item) || 0) + 1);
        return item;
      });
      return counts;
    };
    const old = sources(before);
    for (const [src, count] of sources(after))
      if (count > (old.get(src) || 0)) {
        preflight(doc);
        break;
      }
  }
  function guard(w, h, frames = 1) {
    if (!w || !h || w * h * frames > 64_000_000)
      throw Error("Image dimensions exceed 64 megapixels (including animation frames).");
  }
  function header(b) {
    const v = new DataView(b.buffer),
      str = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
    let mime,
      w,
      h,
      frames = 1;
    if (str(0, 8) === "\x89PNG\r\n\x1a\n" && b.length >= 24) {
      mime = "image/png";
      w = v.getUint32(16);
      h = v.getUint32(20);
      for (let i = 8; i + 12 <= b.length;) {
        const n = v.getUint32(i);
        if (str(i + 4, 4) === "acTL" && n >= 8) frames = v.getUint32(i + 8);
        i += n + 12;
      }
    } else if (/^GIF8[79]a$/.test(str(0, 6)) && b.length >= 13) {
      mime = "image/gif";
      w = v.getUint16(6, true);
      h = v.getUint16(8, true);
      let i = 13 + (b[10] & 128 ? 3 * 2 ** ((b[10] & 7) + 1) : 0),
        count = 0;
      const skip = () => {
        while (i < b.length) {
          const n = b[i++];
          if (!n) break;
          i += n;
        }
      };
      while (i < b.length) {
        const tag = b[i++];
        if (tag === 0x2c && i + 9 <= b.length) {
          count++;
          const flags = b[i + 8];
          i += 9 + (flags & 128 ? 3 * 2 ** ((flags & 7) + 1) : 0);
          i++;
          skip();
        } else if (tag === 0x21) {
          i++;
          skip();
        } else break;
      }
      frames = Math.max(1, count);
    } else if (b[0] === 255 && b[1] === 216) {
      mime = "image/jpeg";
      for (let i = 2; i + 8 < b.length;) {
        if (b[i++] !== 255) continue;
        const marker = b[i++];
        if (marker === 0xda) break;
        if (marker === 255 || marker === 216) continue;
        const n = v.getUint16(i);
        if (n < 2) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          h = v.getUint16(i + 3);
          w = v.getUint16(i + 5);
          break;
        }
        i += n;
      }
    } else if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") {
      mime = "image/webp";
      let count = 0;
      const u24 = (i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
      for (let i = 12; i + 8 <= b.length;) {
        const kind = str(i, 4),
          n = v.getUint32(i + 4, true),
          p = i + 8;
        if (p + n > b.length) break;
        if (kind === "VP8X" && n >= 10) {
          w = 1 + u24(p + 4);
          h = 1 + u24(p + 7);
        }
        if (!w && kind === "VP8 " && n >= 10) {
          w = v.getUint16(p + 6, true) & 16383;
          h = v.getUint16(p + 8, true) & 16383;
        }
        if (!w && kind === "VP8L" && n >= 5) {
          const bits = v.getUint32(p + 1, true);
          w = 1 + (bits & 16383);
          h = 1 + ((bits >>> 14) & 16383);
        }
        if (kind === "ANMF") count++;
        i = p + n + (n % 2);
      }
      frames = Math.max(1, count);
    } else if (str(4, 4) === "ftyp" && /avif|avis/.test(str(8, Math.min(64, b.length - 8))))
      mime = "image/avif";
    if (w && h) guard(w, h, frames);
    return { mime, w, h, animated: frames > 1 };
  }
  const dataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Unable to read image"));
      reader.readAsDataURL(blob);
    });
  async function process(file, { purpose = "canvas", signal } = {}) {
    signal?.throwIfAborted();
    if (!ACCEPT.split(",").includes(file?.type))
      throw Error("Choose a PNG, JPEG, WebP, GIF, AVIF or SVG image.");
    if (!file.size || file.size > MAX_BYTES)
      throw Error("Images must be non-empty and at most 8 MB.");
    let blob = file;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = header(bytes);
    if (file.type === "image/svg+xml") {
      if (file.size > 1_000_000) throw Error("SVG images must be at most 1 MB.");
      const svg = window.sanitizeSvg(new TextDecoder().decode(bytes));
      if (!svg) throw Error("Invalid SVG content.");
      const viewBox = (svg.getAttribute("viewBox") || "").split(/[ ,]+/).map(Number);
      const width = parseFloat(svg.getAttribute("width")) || viewBox[2];
      const height = parseFloat(svg.getAttribute("height")) || viewBox[3];
      if (width && height) guard(width, height);
      blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: file.type });
    } else if (info.mime !== file.type) throw Error("Unable to decode: MIME/content mismatch.");
    signal?.throwIfAborted();
    const url = URL.createObjectURL(blob),
      image = new Image();
    try {
      await new Promise((resolve, reject) => {
        const done = (error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          image.onload = null;
          image.onerror = null;
          if (error) {
            image.src = "";
            reject(error);
          } else resolve();
        };
        const abort = () => done(new DOMException("Upload cancelled", "AbortError"));
        const timer = setTimeout(
          () => done(Error("Image decode timed out after 15 seconds.")),
          15000,
        );
        image.onload = () => done();
        image.onerror = () => done(Error("Unable to decode image."));
        signal?.addEventListener("abort", abort, { once: true });
        image.src = url;
      });
      // HTMLImageElement applies EXIF orientation by default, including when drawn to canvas.
      const originalWidth = image.naturalWidth,
        originalHeight = image.naturalHeight;
      guard(originalWidth, originalHeight);
      let pixelWidth = originalWidth,
        pixelHeight = originalHeight;
      if (
        purpose === "chat" ||
        (Math.max(originalWidth, originalHeight) > MAX_SIDE &&
          file.type !== "image/svg+xml" &&
          !info.animated &&
          file.type !== "image/gif")
      ) {
        const canvas = document.createElement("canvas");
        let scale = Math.min(
          1,
          (purpose === "chat" ? 2048 : MAX_SIDE) / Math.max(originalWidth, originalHeight),
        );
        let encoded = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          canvas.width = Math.max(1, Math.round(originalWidth * scale));
          canvas.height = Math.max(1, Math.round(originalHeight * scale));
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          let alpha = false;
          if (purpose !== "chat") {
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < pixels.length; i += 4)
              if (pixels[i] < 255) {
                alpha = true;
                break;
              }
          }
          const type =
            purpose !== "chat" && (alpha || file.type === "image/png") ? "image/png" : "image/webp";
          const output = await new Promise((resolve) =>
            canvas.toBlob(resolve, type, purpose === "chat" ? 0.82 : 0.9),
          );
          signal?.throwIfAborted();
          if (!output) throw Error("Unable to encode image.");
          if (purpose !== "chat" || output.size <= OUTPUT_BYTES) {
            // Keeping original also preserves animation if a larger derivative would waste storage.
            if (purpose === "chat" || output.size < blob.size) {
              encoded = true;
              blob = output;
              pixelWidth = canvas.width;
              pixelHeight = canvas.height;
            }
            break;
          }
          scale *= 0.75;
        }
        if (purpose === "chat" && (!encoded || blob.size > OUTPUT_BYTES))
          throw Error("Unable to compress image below 2 MB.");
      }
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
      let src = cache.get(hash);
      if (!src) {
        src = await dataUrl(blob);
        cache.set(hash, src);
        if (cache.size > 32) cache.delete(cache.keys().next().value);
      }
      signal?.throwIfAborted();
      return {
        src,
        originalWidth,
        originalHeight,
        pixelWidth,
        pixelHeight,
        width: originalWidth,
        height: originalHeight,
        bytes: blob.size,
        mime: blob.type,
        hash,
        name: file.name || "Image",
      };
    } finally {
      image.src = "";
      URL.revokeObjectURL(url);
    }
  }
  function prepare(file, options) {
    const job = queue.then(() => process(file, options));
    queue = job.catch(() => {});
    return job;
  }
  window.imageUpload = Object.freeze({
    prepare,
    preflight,
    preflightChange,
    batch,
    MAX_BYTES,
    OUTPUT_BYTES,
    MAX_SIDE,
    ACCEPT,
  });
})();
