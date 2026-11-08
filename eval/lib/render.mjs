// Headless Chrome via the repo's playwright dependency. Uses the bundled Chromium if installed,
// otherwise the system Google Chrome (channel "chrome"). Never downloads anything.
let browserPromise = null;

async function launch() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return null;
  }
  const chromium = playwright.chromium || playwright.default?.chromium;
  for (const options of [{}, { channel: "chrome" }, { channel: "chromium" }]) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function browser() {
  browserPromise ??= launch();
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  if (b) await b.close();
}

/** Load HTML, wait for fonts/images, and return per-label layout facts. */
export async function measure(html, { width = 1440, height = 900 } = {}) {
  const b = await browser();
  if (!b) return null;
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    return await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-name],[data-node-label]")) {
        const name = el.getAttribute("data-name") ?? el.getAttribute("data-node-label");
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const textEl = el.querySelector("span") || el;
        const facts = {
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          color: getComputedStyle(textEl).color,
          background: cs.backgroundColor,
          backgroundImage: cs.backgroundImage,
          fontSize: parseFloat(getComputedStyle(textEl).fontSize),
          fontFamily: getComputedStyle(textEl).fontFamily,
          overflowX: el.scrollWidth > el.clientWidth + 1,
          overflowY: el.scrollHeight > el.clientHeight + 1,
          textOverflow: cs.textOverflow,
          whiteSpace: cs.whiteSpace,
        };
        (out[name] ||= []).push(facts);
      }
      return out;
    });
  } finally {
    await page.close();
  }
}

/** Screenshot HTML to a PNG buffer (used for references and the refinement start screen). */
export async function screenshot(html, { width = 1440, height = 900, fullPage = false } = {}) {
  const b = await browser();
  if (!b)
    throw new Error(
      "No Chromium available: install Google Chrome or run `npx playwright install chromium`",
    );
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    return await page.screenshot({ type: "png", fullPage });
  } finally {
    await page.close();
  }
}
