import test from "node:test";
import assert from "node:assert/strict";
import {
  searchStockPhotos,
  fetchImageAsDataUrl,
  attribution,
  isSafeRemoteUrl,
  sniffImageType,
  imageSize,
  trackUnsplashDownload,
} from "./images.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwHwYZcHMA8YQL9fJmlpYAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 80, 1, 1, 0x11, 0, 0xff, 0xd9,
]);
const GIF = Buffer.from("R0lGODlhBQAHAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=", "base64");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBPVP8X"),
  Buffer.alloc(8),
  Buffer.from([9, 0, 0, 4, 0, 0]),
]);

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    for (const [match, respond] of routes) if (url.includes(match)) return respond(url, opts);
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
}
const img = (buf, type) => () => new Response(buf, { headers: { "content-type": type } });

test("isSafeRemoteUrl allows public https only", () => {
  assert.ok(isSafeRemoteUrl("https://images.unsplash.com/photo-1?w=10"));
  for (const bad of [
    "http://example.com/a.png",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://10.0.0.2/a",
    "https://192.168.1.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/a",
    "https://user:pw@example.com/a",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "nope",
  ])
    assert.equal(isSafeRemoteUrl(bad), false, bad);
});

test("searchStockPhotos uses Openverse without a key", async () => {
  const net = fakeFetch([
    [
      "api.openverse.org",
      () =>
        Response.json({
          results: [
            {
              url: "https://live.staticflickr.com/1/a.jpg",
              width: 1600,
              height: 900,
              title: "Mountain lake",
              creator: "Ann",
              creator_url: "https://flickr.com/ann",
              license: "by",
              license_version: "2.0",
              license_url: "https://creativecommons.org/licenses/by/2.0/",
              foreign_landing_url: "https://flickr.com/p/1",
              provider: "flickr",
            },
            { url: "http://insecure.example/b.jpg", width: 10, height: 10, license: "cc0" },
          ],
        }),
    ],
  ]);
  const res = await searchStockPhotos("mountain lake", {
    orientation: "landscape",
    count: 3,
    fetch: net.fetch,
    accessKey: "",
  });
  assert.equal(res.source, "openverse");
  assert.equal(res.results.length, 1);
  const url = new URL(net.calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.openverse.org/v1/images/");
  assert.deepEqual(
    [
      url.searchParams.get("q"),
      url.searchParams.get("license_type"),
      url.searchParams.get("aspect_ratio"),
      url.searchParams.get("page_size"),
    ],
    ["mountain lake", "commercial", "wide", "3"],
  );
  const [p] = res.results;
  assert.deepEqual(
    [p.width, p.height, p.alt, p.author, p.license, p.source],
    [1600, 900, "Mountain lake", "Ann", "CC BY 2.0", "openverse"],
  );
  assert.equal(attribution(p), '"Mountain lake" by Ann, CC BY 2.0 (via flickr, Openverse)');
});

test("searchStockPhotos uses Unsplash with a key and tracks downloads", async () => {
  const net = fakeFetch([
    [
      "api.unsplash.com/search",
      () =>
        Response.json({
          results: [
            {
              id: "x",
              width: 4000,
              height: 6000,
              alt_description: "a coffee cup",
              color: "#c0a080",
              urls: {
                raw: "https://images.unsplash.com/photo-1?ixid=abc",
                regular: "https://images.unsplash.com/photo-1?w=1080",
              },
              user: { name: "Bo", links: { html: "https://unsplash.com/@bo" } },
              links: {
                html: "https://unsplash.com/photos/x",
                download_location: "https://api.unsplash.com/photos/x/download",
              },
            },
          ],
        }),
    ],
    ["api.unsplash.com/photos", () => Response.json({ url: "ok" })],
  ]);
  const res = await searchStockPhotos("coffee", {
    orientation: "portrait",
    fetch: net.fetch,
    accessKey: "KEY",
  });
  assert.equal(res.source, "unsplash");
  assert.equal(net.calls[0].opts.headers.authorization, "Client-ID KEY");
  assert.equal(new URL(net.calls[0].url).searchParams.get("orientation"), "portrait");
  const [p] = res.results;
  assert.match(p.url, /^https:\/\/images\.unsplash\.com\/photo-1\?ixid=abc&w=1600/);
  assert.deepEqual(
    [p.width, p.height, p.alt, p.author, p.license],
    [4000, 6000, "a coffee cup", "Bo", "Unsplash License"],
  );
  assert.equal(attribution(p), "Photo by Bo on Unsplash");
  assert.equal(await trackUnsplashDownload(p, { fetch: net.fetch, accessKey: "KEY" }), true);
});

test("searchStockPhotos never throws on network/API errors", async () => {
  const down = await searchStockPhotos("x", {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    accessKey: "",
  });
  assert.deepEqual(down.results, []);
  assert.match(down.error, /Openverse: fetch failed/);
  const limited = await searchStockPhotos("x", {
    fetch: async () => new Response("", { status: 429 }),
    accessKey: "",
  });
  assert.match(limited.error, /HTTP 429/);
  assert.match((await searchStockPhotos("")).error, /empty/);
});

test("sniff and size detection", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.deepEqual(imageSize(PNG), { width: 3, height: 2 });
  assert.deepEqual(imageSize(JPEG), { width: 80, height: 50 });
  assert.deepEqual(imageSize(GIF), { width: 5, height: 7 });
  assert.deepEqual(imageSize(WEBP), { width: 10, height: 5 });
  assert.deepEqual(imageSize(Buffer.from('<svg viewBox="0 0 120 60"></svg>')), {
    width: 120,
    height: 60,
  });
  assert.equal(sniffImageType(Buffer.from("<html>")), null);
});

test("fetchImageAsDataUrl embeds rasters, sanitizes SVG and enforces limits", async () => {
  const net = fakeFetch([
    ["/a.png", img(PNG, "image/png")],
    ["/b.jpg", img(JPEG, "image/jpeg; charset=binary")],
    [
      "/c.svg",
      img(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" onload="x()"><script>x()</script><rect/></svg>',
        ),
        "image/svg+xml",
      ),
    ],
    ["/page", img(Buffer.from("<html></html>"), "text/html")],
    ["/fake.png", img(Buffer.from("not really"), "image/png")],
    [
      "/big",
      () => new Response(Buffer.alloc(2048, 1), { headers: { "content-type": "image/png" } }),
    ],
    ["/404", () => new Response("", { status: 404 })],
  ]);
  const png = await fetchImageAsDataUrl("https://cdn.example.com/a.png", { fetch: net.fetch });
  assert.deepEqual([png.ok, png.mimeType, png.width, png.height], [true, "image/png", 3, 2]);
  assert.equal(png.dataUrl, "data:image/png;base64," + PNG.toString("base64"));
  assert.equal(
    (await fetchImageAsDataUrl("https://cdn.example.com/b.jpg", { fetch: net.fetch })).mimeType,
    "image/jpeg",
  );
  const svg = await fetchImageAsDataUrl("https://cdn.example.com/c.svg", { fetch: net.fetch });
  const text = Buffer.from(svg.dataUrl.split(",")[1], "base64").toString();
  assert.ok(svg.ok && !text.includes("script") && !text.includes("onload"));
  assert.deepEqual([svg.width, svg.height], [10, 20]);
  assert.match(
    (await fetchImageAsDataUrl("https://cdn.example.com/page", { fetch: net.fetch })).error,
    /not an image/,
  );
  assert.match(
    (await fetchImageAsDataUrl("https://cdn.example.com/fake.png", { fetch: net.fetch })).error,
    /unsupported image format/,
  );
  assert.match(
    (await fetchImageAsDataUrl("https://cdn.example.com/big", { fetch: net.fetch, maxBytes: 1024 }))
      .error,
    /exceeds 1024/,
  );
  assert.match(
    (await fetchImageAsDataUrl("https://cdn.example.com/404", { fetch: net.fetch })).error,
    /HTTP 404/,
  );
  assert.match(
    (await fetchImageAsDataUrl("http://cdn.example.com/a.png", { fetch: net.fetch })).error,
    /https/,
  );
  assert.match(
    (await fetchImageAsDataUrl("https://127.0.0.1/a.png", { fetch: net.fetch })).error,
    /public host/,
  );
  assert.match(
    (
      await fetchImageAsDataUrl("https://cdn.example.com/x", {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      })
    ).error,
    /fetch failed/,
  );
  const passthrough = await fetchImageAsDataUrl("data:image/png;base64," + PNG.toString("base64"));
  assert.equal(passthrough.ok, true);
  assert.equal((await fetchImageAsDataUrl("data:text/html;base64,PGh0bWw+")).ok, false);
});
