// Web page capture: arbitrary-URL capture in an isolated hidden window, cross-origin assets and custom
// fonts embedded, source mapping, recorded interaction states, and the interactive region pickers
// (web page dialog and live preview). Two real HTTP servers on different ports make every asset
// cross-origin; the fonts are real woff2 files from @fontsource/inter served under custom names.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { png } = require("./fixtures/png.cjs");
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

(async () => {
  const fontDir = path.join(__dirname, "..", "node_modules", "@fontsource", "inter", "files");
  const displayFont = await fs.readFile(path.join(fontDir, "inter-latin-700-normal.woff2"));
  const bodyFont = await fs.readFile(path.join(fontDir, "inter-latin-400-normal.woff2"));
  const photo = png(24, 16, [30, 140, 220]),
    texture = png(8, 8, [240, 200, 20]);
  const hits = {},
    cookies = [];
  const assets = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    res.setHeader("access-control-allow-origin", "*");
    const send = (type, body) => {
      res.setHeader("content-type", type);
      res.end(body);
    };
    if (req.url === "/photo.png") return send("image/png", photo);
    if (req.url === "/texture.png") return send("image/png", texture);
    if (req.url === "/display.woff2") return send("font/woff2", displayFont);
    if (req.url === "/body.woff2") return send("font/woff2", bodyFont);
    if (req.url === "/unused.woff2") return send("font/woff2", bodyFont);
    if (req.url === "/fonts.css")
      return send(
        "text/css",
        '@font-face{font-family:"Fixture Display";font-style:normal;font-weight:700;src:local("Nope"),url(/display.woff2) format("woff2")}\n@font-face{font-family:"Unused Face";src:url(/unused.woff2) format("woff2")}',
      );
    res.statusCode = 404;
    res.end();
  });
  await listen(assets);
  const A = "http://127.0.0.1:" + assets.address().port;
  const html = `<!doctype html><html><head><title>Remote fixture</title><link rel="stylesheet" href="${A}/fonts.css"><style>
@font-face{font-family:"Fixture Body";font-weight:400;src:url(${A}/body.woff2) format("woff2")}
body{margin:0;font-family:"Fixture Body",sans-serif}
h1{margin:0;padding:12px;font:700 32px "Fixture Display",serif}
.hero{width:320px;height:120px;background:url(${A}/texture.png) center/cover,rgb(1,2,3)}
.fade{width:200px;height:40px;background-image:linear-gradient(90deg,rgb(255,0,0),rgb(0,0,255))}
.cta{display:inline-block;padding:10px 16px;border:0;background:rgb(10,20,30);color:white;transition:background-color .25s ease-in-out,transform 120ms linear}
.cta:hover{background:rgb(200,0,0)}
.cta:focus-visible{outline:3px solid rgb(0,0,255)}
.cta:active{transform:scale(0.95)}
.card{width:220px;padding:8px;background:rgb(240,240,240);cursor:pointer}
.card:hover .card-title{color:rgb(0,128,0)}
</style></head><body>
<h1 id="headline" data-source="src/pages/Home.tsx:14:7">Captured headline</h1>
<div class="hero" id="hero"></div><div class="fade"></div>
<img id="photo" src="${A}/photo.png" width="48" height="32">
<button class="cta" id="cta">Get started</button>
<div class="card" id="card"><p class="card-title" style="margin:0">Card title</p></div>
<script>
document.cookie='visited=1';
window.open('https://example.com/popup');
const p=document.createElement('p');p.id='dynamic';p.textContent='Rendered by script';document.body.append(p);
const s=document.createElement('section');s.id='fiber';s.textContent='Fiber mapped';s.style.background='rgb(250,250,200)';
s.__reactFiber$fixture={_debugSource:{fileName:'/repo/src/components/Fiber.jsx',lineNumber:21,columnNumber:4}};document.body.append(s);
</script></body></html>`;
  const site = http.createServer((req, res) => {
    cookies.push(req.headers.cookie || "");
    res.setHeader("content-type", "text/html");
    res.setHeader("set-cookie", "session=fixture; Path=/");
    res.end(html);
  });
  await listen(site);
  const url = "http://127.0.0.1:" + site.address().port + "/";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capture-remote-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 }); await moveOffCursor(app);
    await page.waitForFunction(() => !!window.desktop?.captureRemote && !!window.webCapture);
    const { validateDocument } = await import("../integrations/design-store.mjs");

    // URL policy: only http(s) without credentials.
    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://user:pw@127.0.0.1/",
      "not a url",
    ]) {
      const message = await page.evaluate(async (target) => {
        try {
          await window.desktop.captureRemote({ url: target });
          return "accepted";
        } catch (e) {
          return e.message;
        }
      }, bad);
      assert.notEqual(message, "accepted", bad);
    }

    // Probe for the picker: screenshot of the requested viewport plus element boxes.
    const probe = await page.evaluate(
      (target) => window.desktop.captureRemoteProbe({ url: target, width: 800, height: 600 }),
      url,
    );
    assert.equal(probe.width, 800);
    assert.equal(probe.height, 600);
    assert.equal(probe.title, "Remote fixture");
    assert.match(probe.screenshot, /^data:image\/png;base64,/);
    assert.ok(Buffer.from(probe.screenshot.split(",")[1], "base64").length > 1000);
    assert.ok(probe.boxes.some((b) => b.label === "button#cta" && b.width > 20));

    const result = await page.evaluate(
      (target) => window.desktop.captureRemote({ url: target, width: 800, height: 600 }),
      url,
    );
    const document = validateDocument(JSON.parse(JSON.stringify(result.document)));
    const nodes = document.pages[0].nodes;
    const bySelector = (selector) => nodes.find((n) => n.capture?.source?.selector === selector);
    // Isolation: fresh partition per capture (cookie set by the page is never sent back), popup refused.
    assert.ok(
      cookies.length >= 2 && cookies.every((c) => c === ""),
      "each capture uses a fresh in-memory session",
    );
    assert.equal(app.windows().length, 1, "page popups are denied");
    // Scripts run for rendering, but the script element itself is not captured.
    assert.ok(nodes.some((n) => n.text === "Rendered by script"));
    assert.doesNotMatch(result.html, /window\.open|document\.cookie/);
    // Cross-origin bitmap image embedded byte-for-byte.
    const image = bySelector("#photo");
    assert.equal(image.type, "image");
    assert.deepEqual(Buffer.from(image.src.split(",")[1], "base64"), photo);
    // CSS background image (cross-origin) → image paint above the solid background colour.
    const hero = bySelector("#hero");
    assert.equal(hero.fills[0].type, "image");
    assert.equal(hero.fills[0].fit, "cover");
    assert.deepEqual(Buffer.from(hero.fills[0].src.split(",")[1], "base64"), texture);
    assert.deepEqual(hero.fills[1], { type: "solid", color: "#010203" });
    assert.match(
      nodes.find((n) => n.capture?.source?.selector === "body > div:nth-of-type(2)").gradient,
      /linear-gradient\(90deg, rgb\(255, 0, 0\), rgb\(0, 0, 255\)\)/,
    );
    // Custom fonts: the used @font-face fonts are embedded (from a cross-origin sheet and an inline rule);
    // the unused one is never downloaded.
    const faces = Object.fromEntries((document.fontFaces || []).map((f) => [f.family, f]));
    assert.deepEqual(Object.keys(faces).sort(), ["Fixture Body", "Fixture Display"]);
    assert.equal(faces["Fixture Display"].weight, "700");
    assert.deepEqual(
      Buffer.from(faces["Fixture Display"].src.replace(/^data:font\/woff2;base64,/, ""), "base64"),
      displayFont,
    );
    assert.deepEqual(
      Buffer.from(faces["Fixture Body"].src.replace(/^data:font\/woff2;base64,/, ""), "base64"),
      bodyFont,
    );
    assert.equal(hits["/unused.woff2"], undefined);
    assert.match(result.html, /@font-face\{font-family:"Fixture Display"/);
    assert.match(nodes.find((n) => n.text === "Captured headline").fontFamily, /Fixture Display/);
    // Source mapping: page URL, selector and XPath on every element; dev source file:line on localhost.
    const headline = bySelector("#headline");
    assert.equal(headline.capture.source.url, url);
    assert.equal(headline.capture.source.xpath, "/html[1]/body[1]/h1[1]");
    assert.deepEqual(headline.capture.source.dev, {
      file: "src/pages/Home.tsx",
      line: 14,
      column: 7,
      via: "data-source",
    });
    assert.deepEqual(bySelector("#fiber").capture.source.dev, {
      file: "/repo/src/components/Fiber.jsx",
      line: 21,
      column: 4,
      via: "react",
    });
    assert.equal(nodes[0].capture.source.url, url);
    // Interaction behaviour: forced :hover/:focus-visible/:active deltas, child restyles and transitions.
    const cta = bySelector("#cta");
    assert.equal(cta.capture.states.hover.style.backgroundColor, "rgb(200, 0, 0)");
    assert.equal(cta.capture.states.hover.from.backgroundColor, "rgb(10, 20, 30)");
    assert.equal(cta.capture.states["focus-visible"].style.outlineStyle, "solid");
    assert.equal(cta.capture.states["focus-visible"].style.outlineColor, "rgb(0, 0, 255)");
    assert.match(cta.capture.states.active.style.transform, /^matrix\(0\.95, 0, 0, 0\.95/);
    assert.deepEqual(cta.capture.transitions, [
      { property: "background-color", duration: 0.25, timing: "ease-in-out", delay: 0 },
      { property: "transform", duration: 0.12, timing: "linear", delay: 0 },
    ]);
    assert.ok(
      cta.capture.notes.some((n) =>
        /^On :hover: background-color rgb\(10, 20, 30\) → rgb\(200, 0, 0\)/.test(n),
      ),
    );
    assert.ok(cta.capture.notes.includes("Transition background-color 250ms ease-in-out"));
    const card = bySelector("#card");
    assert.equal(card.capture.states.hover.descendants[0].selector, "#card > p");
    assert.equal(card.capture.states.hover.descendants[0].style.color, "rgb(0, 128, 0)");
    assert.equal(
      bySelector("#headline").capture.states,
      undefined,
      "non-interactive elements are not probed",
    );
    // Region capture: clipping to the region and bounds validation.
    const region = await page.evaluate(
      (target) =>
        window.desktop.captureRemote({
          url: target,
          width: 800,
          height: 600,
          region: { x: 0, y: 0, width: 400, height: 60 },
          interactions: false,
        }),
      url,
    );
    assert.equal(region.document.pages[0].nodes[0].w, 400);
    assert.ok(region.document.pages[0].nodes.some((n) => n.text === "Captured headline"));
    assert.ok(!region.document.pages[0].nodes.some((n) => n.text === "Get started"));
    const outside = await page.evaluate(async (target) => {
      try {
        await window.desktop.captureRemote({
          url: target,
          width: 800,
          height: 600,
          region: { x: 700, y: 0, width: 200, height: 10 },
        });
      } catch (e) {
        return e.message;
      }
    }, url);
    assert.match(outside, /region/);

    // Web page dialog: load, hover highlight on the screenshot, drag a region, insert with fonts.
    await page.evaluate(() => window.webCapture.open());
    await page.locator("#capture-web-url").fill(url);
    await page.locator("#capture-web-size").selectOption("1280x800");
    await page.locator("#capture-web-load").click();
    await page.locator("#capture-web-stage .capture-picker").waitFor({ timeout: 20000 });
    const shot = await page.locator("#capture-web-shot").boundingBox();
    const scale = shot.width / 1280;
    const ctaBox = probe.boxes.find((b) => b.label === "button#cta");
    await page.mouse.move(shot.x + (ctaBox.x + 5) * scale, shot.y + (ctaBox.y + 5) * scale);
    await page.locator("#capture-web-stage .capture-picker-highlight:not([hidden])").waitFor();
    assert.equal(
      await page.locator("#capture-web-stage .capture-picker-highlight span").textContent(),
      "button#cta",
    );
    await page.mouse.move(shot.x + 0, shot.y + 0);
    await page.mouse.down();
    await page.mouse.move(shot.x + 300 * scale, shot.y + 90 * scale, { steps: 5 });
    assert.equal(await page.locator("#capture-web-stage .capture-picker-rect").isVisible(), true);
    await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById("capture-web-dialog").open, null, {
      timeout: 30000,
    });
    const inserted = await page.evaluate(() => window.design.getDocument());
    const frame = inserted.pages.flatMap((p) => p.nodes).find((n) => n.name === "Captured region");
    assert.ok(
      Math.abs(frame.w - 300) <= 2 && Math.abs(frame.h - 90) <= 2,
      `dragged region ${frame.w}×${frame.h}`,
    );
    assert.ok(
      inserted.pages
        .flatMap((p) => p.nodes)
        .some(
          (n) =>
            n.text === "Captured headline" && n.capture?.source?.dev?.file === "src/pages/Home.tsx",
        ),
    );
    assert.ok(inserted.fontFaces.some((f) => f.family === "Fixture Display"));
    validateDocument(JSON.parse(JSON.stringify(inserted)));
    const fontLoaded = await page.evaluate(async () => {
      await document.fonts.load('700 32px "Fixture Display"');
      return (
        document.fonts.check('700 32px "Fixture Display"') &&
        [...document.fonts].some(
          (f) => f.family.replace(/"/g, "") === "Fixture Display" && f.status === "loaded",
        )
      );
    });
    assert.equal(fontLoaded, true, "embedded font registered in the editor");
    // Invalid embedded fonts are rejected by both validators.
    const rejected = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.fontFaces = [
        { family: "X", weight: "400", style: "normal", src: "https://evil.example/x.woff2" },
      ];
      try {
        window.design.setDocument(d);
        return "accepted";
      } catch (e) {
        return e.message;
      }
    });
    assert.match(rejected, /font/i);
    assert.throws(
      () =>
        validateDocument({
          ...inserted,
          fontFaces: [
            { family: "X;}", weight: "400", style: "normal", src: "data:font/woff2;base64,AA==" },
          ],
        }),
      /font/,
    );

    // Live preview region picker: hover highlights the element in the running app; a click captures its box.
    await page.evaluate((target) => window.livePreview.show(target), url);
    await page.locator("#live-frame").waitFor();
    await page.frameLocator("#live-frame").locator("#cta").waitFor();
    // The frame toolbar no longer has a region button (Wonder parity); the picker stays reachable through the API.
    await page.evaluate(() => { void window.livePreview.captureRegion(); });
    const wrap = await page.locator("#live-preview .live-frame-wrap").boundingBox();
    const frameScale = await page
      .locator("#live-frame")
      .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
    const liveCta = await page
      .frameLocator("#live-frame")
      .locator("#cta")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    await page.mouse.move(
      wrap.x + (liveCta.x + 4) * frameScale,
      wrap.y + (liveCta.y + 4) * frameScale,
    );
    await page.locator("#live-preview .capture-picker-highlight:not([hidden])").waitFor();
    assert.equal(
      await page.locator("#live-preview .capture-picker-highlight span").textContent(),
      "button#cta",
    );
    const before = await page.evaluate(
      () =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .filter((n) => n.name === "Captured region").length,
    );
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
      (count) =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .filter((n) => n.name === "Captured region").length > count,
      before,
      { timeout: 20000 },
    );
    const live = await page.evaluate(() => {
      const all = window.design.getDocument().pages.flatMap((p) => p.nodes),
        regions = all.filter((n) => n.name === "Captured region");
      const root = regions[regions.length - 1];
      const ids = new Set([root.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const n of all)
          if (ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id);
            grew = true;
          }
      }
      return { root, children: all.filter((n) => n.id !== root.id && ids.has(n.id)) };
    });
    assert.ok(
      Math.abs(live.root.w - Math.ceil(liveCta.width)) <= 2 &&
        Math.abs(live.root.h - Math.ceil(liveCta.height)) <= 2,
      `element box ${live.root.w}×${live.root.h}`,
    );
    assert.ok(JSON.stringify(live.children).includes("Get started"));
    // Escape cancels the picker without capturing.
    await page.evaluate(() => { void window.livePreview.captureRegion(); });
    await page.locator("#live-preview .capture-picker").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#live-preview .capture-picker").count(), 0);
    console.log(
      "PASS web page capture: isolated session, cross-origin images/backgrounds/custom woff2 fonts embedded, source mapping (selector/XPath/dev file:line), hover/focus/active/transition recovery, screenshot and live region pickers",
    );
  } finally {
    await app.close();
    await new Promise((r) => site.close(r));
    await new Promise((r) => assets.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
