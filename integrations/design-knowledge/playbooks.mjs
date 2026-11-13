// Domain playbooks with numeric contracts. Numbers are defaults an agent can verify in a screenshot.

export const playbooks = [
  {
    id: "landing-page",
    name: "Landing page",
    aliases: ["landing", "marketing", "homepage", "website", "launch", "hero", "product page"],
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    structure: [
      "Story arc: promise → proof → detail → action. Every section answers one question in that order.",
      "Nav (64–72px tall): logo left, 3–5 links, one primary action right.",
      "Hero is one stage: full-bleed image, shader or typographic composition with the headline on it. Headline ≤ 10 words, subline ≤ 25 words, one primary + one secondary action.",
      "Proof directly under the hero: a product screenshot, a real quote with full name and role, or a concrete number with its source. Skip fake logo walls.",
      "Feature sections alternate shape: one large split (text 5 cols / media 7 cols), one list with icons, one stat row, one full-width media. Never three identical 3-card grids.",
      "Closing section repeats the primary action with a new sentence, not the hero headline.",
      "Footer: 3–4 link columns at 14px, muted, plus legal line at 12–13px.",
    ],
    numbers: [
      "Container max-w-[1200px]–max-w-[1280px], side padding px-6 (mobile) / px-10–px-20 (desktop).",
      "Section padding py-20 to py-32 desktop, py-16 mobile. Gap between heading and content 40–64px.",
      "Hero headline 56–96px desktop (40–48px mobile), leading 1.0–1.1, tracking-tight. Body 16–20px, max-w-[60ch].",
      "Primary button 44–52px tall, px-5–px-7, 15–16px semibold.",
      "Exactly 1 accent color, used only by actions and at most 1 highlight per section.",
    ],
    density: {
      airy: "py-32 sections, 20px body — launches and luxury.",
      comfortable: "py-24 sections, 18px body — default.",
      compact: "py-16 sections, 16px body — dev tools and docs-heavy products.",
    },
    states: [
      "Nav: default, scrolled (surface + border), mobile menu open.",
      "Form/email capture: default, focus, error, success message.",
      "Buttons: default, hover, focus.",
    ],
    failures: [
      "Text column beside a floating photo card instead of a hero stage.",
      "Purple-blue gradient blobs behind the headline.",
      "Three identical feature cards with emoji icons.",
      "“Trusted by 10,000+ teams” with invented logos.",
      "Every section centered.",
      "CTA copy “Get started” repeated four times.",
    ],
  },
  {
    id: "web-app",
    name: "Web app / dashboard",
    aliases: [
      "dashboard",
      "app",
      "admin",
      "saas",
      "console",
      "portal",
      "analytics",
      "crm",
      "web app",
    ],
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "laptop", width: 1280, height: 800 },
    ],
    structure: [
      "Shell: sidebar 232–264px (or 64px collapsed) + top bar 52–60px + content. Content scrolls; shell does not.",
      "Page header: title (20–24px semibold), one-line description or breadcrumbs, primary action right-aligned.",
      "Dashboard: one hero metric row (3–4 KPIs), then one primary chart (2/3 width) with a side list (1/3), then a table. Not 9 equal cards.",
      "Group settings and filters in a toolbar above the data they affect.",
      "Detail views: main column + 320px inspector panel on the right.",
    ],
    numbers: [
      "Base body 14px, meta 12–13px, page title 20–24px, KPI figures 28–36px tabular-nums.",
      "Card padding p-4–p-6; gap between cards 16–24px; content padding px-6–px-8.",
      "Controls 32–36px tall (compact) / 40px (comfortable). Icon size 16–20px.",
      "Sidebar items 32–36px tall, 8px radius, 12px horizontal padding, active item = surfaceAlt fill + foreground text.",
      "Charts: 240–320px tall, 1 highlighted series in accent, others in muted greys, axis labels 12px.",
    ],
    density: {
      compact: "32px controls, 36px table rows, 12px gaps — ops, finance, dev tools.",
      comfortable: "40px controls, 48px rows, 16–24px gaps — default.",
      spacious: "44px controls, 56px rows — consumer dashboards and first-run.",
    },
    states: [
      "Empty (first run): illustration or icon, one sentence, one action.",
      "Loading: skeletons matching final layout, not spinners in every card.",
      "Error: inline message with retry, keep the shell.",
      "Partial data, permission denied, offline.",
      "Selected, hover and focus for nav items and rows.",
    ],
    failures: [
      "Every widget in a card with a shadow, nested in another card.",
      "KPI cards with fake trend arrows on round numbers.",
      "Charts with rainbow series colors.",
      "Sidebar with 20 items and no grouping.",
      "Primary button color also used for nav highlight, chart, and badges.",
    ],
  },
  {
    id: "data-table",
    name: "Data table",
    aliases: ["table", "list", "grid", "records", "inventory", "orders", "transactions", "users"],
    viewports: [{ name: "desktop", width: 1440, height: 900 }],
    structure: [
      "Structure: toolbar (search, filters, view options, primary action) → table (Table → Row → Cell) → footer (count, pagination).",
      "First column identifies the row (name + secondary line or avatar). Last column holds row actions (… menu, 32px).",
      "Header row sticky, 12–13px medium, muted, sentence case. Sort indicator on the sorted column only.",
      "Status as dot or chip + text. Numbers right-aligned with tabular-nums; text left-aligned; dates in one format.",
      "Bulk selection: checkbox column 40px; a contextual bar replaces the toolbar when rows are selected.",
    ],
    numbers: [
      "Row height: 36px compact, 48px comfortable, 56px with two-line cells. Cell padding px-3–px-4.",
      "Body 13–14px. Secondary line 12px muted.",
      "Horizontal row dividers 1px border; no vertical dividers unless spreadsheet-like.",
      "Min column widths: checkbox 40, status 120, date 120, amount 120, actions 48.",
      "Show 20–50 rows per page; pagination text “1–25 of 1,284”.",
    ],
    density: {
      compact: "36px rows for power users.",
      comfortable: "48px rows default.",
      relaxed: "56px rows for two-line cells or touch.",
    },
    states: [
      "Empty with no data vs. empty because of filters (offer “Clear filters”).",
      "Loading skeleton rows (5–8).",
      "Error row/banner with retry.",
      "Row hover, selected, focused; disabled actions.",
      "Truncated text with full value on hover/title.",
    ],
    failures: [
      "Zebra stripes plus dividers plus card borders.",
      "Center-aligned numbers.",
      "All-caps headers in 10px.",
      "Identical fake rows (“John Doe”, $100.00).",
      "Actions as five inline icon buttons per row.",
    ],
  },
  {
    id: "mobile-app",
    name: "Mobile app",
    aliases: ["mobile", "ios", "android", "phone", "native app", "app screen"],
    viewports: [
      { name: "iPhone", width: 390, height: 844 },
      { name: "small", width: 375, height: 812 },
      { name: "Android", width: 412, height: 915 },
    ],
    structure: [
      "Frame: status bar (47px on 390×844, time left, signal/wifi/battery right) → navigation/title area → content → tab bar or bottom action → home indicator area (34px).",
      "Title: large title 30–34px bold for top-level screens; 17px semibold centered for pushed screens with a back chevron.",
      "Tab bar: 3–5 items, 49px + 34px safe area, icon 24px over 10–11px label; active = accent or foreground, inactive = muted. A floating capsule tab bar (inset 16px, radius full) is fine for consumer apps.",
      "Primary action sits in the thumb zone: bottom sticky button (50–56px tall, inset 16–20px) or within the lower third.",
      "Lists: 44–64px rows with leading icon/avatar (28–40px), title 16–17px, subtitle 13–15px muted, trailing chevron or value.",
    ],
    numbers: [
      "Side padding 16–20px. Section gap 24–32px. Item gap within a group 12–16px.",
      "Touch targets ≥ 44×44. Buttons 48–56px tall, radius 12–16 or full.",
      "Body 15–17px, caption ≥ 12px, large title 30–34px.",
      "Safe areas: top 47–59px, bottom 34px. Nothing interactive in them.",
      "Cards radius 16–20px; sheets radius 20–28px top corners with a 36×5px grabber.",
    ],
    density: {
      comfortable: "16px padding, 56px list rows — default.",
      compact: "44px rows for settings and long lists.",
    },
    states: [
      "Empty, loading (skeleton), error, offline banner.",
      "Pressed state for rows and buttons.",
      "Keyboard-up layout for forms (primary action above keyboard).",
      "Permission prompts and denied states.",
    ],
    failures: [
      "Desktop layout shrunk to 390px.",
      "Hamburger menu instead of a tab bar for 3–5 destinations.",
      "Text under 12px.",
      "Content hidden under the status bar or home indicator.",
      "Multiple floating action buttons.",
    ],
  },
  {
    id: "settings-form",
    name: "Settings and forms",
    aliases: [
      "settings",
      "form",
      "forms",
      "preferences",
      "account",
      "profile",
      "checkout form",
      "signup",
      "sign up",
      "onboarding form",
    ],
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    structure: [
      "Settings: left category nav (200–240px) + content column max-w-[720px]. Each section: title 16–18px semibold, one-line description, then fields.",
      "Two-column settings rows on desktop: label + description (left, 1/3) and control (right, 2/3). Toggles right-aligned.",
      "Forms: single column, labels above fields, related fields side by side only when short (city / postcode).",
      "Primary submit at the end of the form, left-aligned with fields; destructive actions in a separate “Danger zone” section.",
      "Save model: autosave with a quiet “Saved” confirmation, or a sticky footer bar that appears when dirty.",
    ],
    numbers: [
      "Inputs 40px tall (36 compact, 48 mobile), px-3, radius from archetype md, 1px border.",
      "Label 14px medium, 6–8px above input. Helper/error 12–13px, 6px below.",
      "Field gap 20–24px. Section gap 40–48px with a 1px divider or heading.",
      "Focus ring 2px accent + 2px offset. Error border and text in danger + icon.",
      "Checkbox/radio 16–20px with a 44px hit area on mobile.",
    ],
    density: {
      comfortable: "40px inputs, 24px field gap — default.",
      compact: "36px inputs, 16px gap — admin consoles.",
    },
    states: [
      "Default, focus, filled, disabled, read-only, error, success.",
      "Submitting (button loading, fields locked).",
      "Unsaved-changes warning.",
      "Destructive confirmation with typed name for irreversible actions.",
    ],
    failures: [
      "Placeholder text used as the label.",
      "Errors only shown in a toast.",
      "Multi-column forms with mismatched field widths.",
      "Every setting in its own card.",
      "Red delete buttons next to save.",
    ],
  },
  {
    id: "slides",
    name: "Slides / presentation",
    aliases: ["slides", "slide", "deck", "presentation", "pitch", "keynote", "pitch deck"],
    viewports: [{ name: "slide", width: 1920, height: 1080 }],
    structure: [
      "One idea per slide. The headline states the takeaway as a sentence (“Churn fell 31% after onboarding v2”), not a topic (“Churn”).",
      "Layout contracts: title; section divider; statement (one big sentence); split (text 40% / media 60%); big number + context; chart + takeaway; quote; 3-up comparison; timeline; closing/ask.",
      "If content does not fit, split the slide — never shrink type below the minimums.",
      "Consistent safe margins and a fixed position for headline, page number and logo across the deck.",
    ],
    numbers: [
      "Safe margins 96–120px on all sides. 12-column grid, 24–32px gutters.",
      "Headline 56–80px, statement slides 96–140px, body 28–36px, captions/footnotes ≥ 20px.",
      "Max 40 words of body per slide; max 5 bullets; max 1 chart.",
      "Big-number slides: figure 200–320px tabular, label 32px.",
      "Charts: 1 highlighted series, direct labels instead of legends, 24px axis labels.",
    ],
    density: {
      presenting: "≤ 25 words per slide, huge type.",
      reading: "≤ 60 words for decks sent as documents; still one idea per slide.",
    },
    states: [
      "Title, section divider and closing slides designed, not only content slides.",
      "Light and dark slide variants if the archetype allows.",
      "Overflow handled by splitting: a “continued” slide keeps the same headline position and grid.",
    ],
    failures: [
      "Topic-label headlines.",
      "Body text under 24px.",
      "Template chrome (gradient bars, logos) on every slide.",
      "Bullets copied from a document.",
      "Stock photos of handshakes.",
    ],
  },
  {
    id: "e-commerce",
    name: "E-commerce",
    aliases: [
      "shop",
      "store",
      "ecommerce",
      "e-commerce",
      "product",
      "checkout",
      "cart",
      "catalog",
      "retail",
    ],
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    structure: [
      "Product listing: filter bar (or left rail 240px) + grid of 3–4 columns desktop, 2 on mobile. Card = image (consistent aspect 4:5 or 1:1) → name → price → optional swatches.",
      "Product detail: gallery 7 cols (main image + thumbnails) / buy box 5 cols (name, price, rating with count, variant selectors, quantity, add to bag, delivery estimate). Buy box sticky on desktop.",
      "Below the fold: details, materials and care, size guide, reviews with distribution, related products.",
      "Cart: line items with image 80–96px, name, variant, qty stepper, price; summary panel with subtotal, shipping, tax, total; one checkout action.",
      "Checkout: 3 steps max (contact/shipping → payment → review), order summary always visible.",
    ],
    numbers: [
      "Product grid gap 16–24px desktop, 12px mobile. Card text 14–15px, price 15–16px semibold tabular.",
      "Add to bag button full width in buy box, 48–56px tall.",
      "Variant swatches 32–40px; size chips 44px tall min.",
      "Prices realistic: $48, $129, €1,450, never $99.99 everywhere.",
    ],
    density: {
      browsing: "Large imagery, 3 columns — fashion, home.",
      catalog: "4–5 columns, compact cards — electronics, grocery.",
    },
    states: [
      "Out of stock / low stock (“Only 3 left” only if real).",
      "Sale price with original struck through.",
      "Variant unavailable (disabled with reason).",
      "Empty cart, adding to cart (loading), added confirmation.",
      "Payment error inline.",
    ],
    failures: [
      "Inconsistent image aspect ratios in the grid.",
      "Urgency banners and countdown timers everywhere.",
      "Hidden shipping costs until the last step.",
      "Grey boxes as product images.",
      "Ratings of 5.0 with round review counts.",
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding",
    aliases: [
      "onboarding",
      "welcome",
      "first run",
      "setup",
      "getting started",
      "tutorial",
      "walkthrough",
    ],
    viewports: [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 900 },
    ],
    structure: [
      "Goal: reach the first moment of value in ≤ 3 steps. Ask only what is needed to personalise that moment.",
      "Each step: progress (dots or “2 of 3”), one question or one idea, a visual that previews the outcome, one primary action, a quiet skip/back.",
      "Choice steps use large selectable cards or chips (multi-select shows a count), not dropdowns.",
      "End on a real, populated screen (sample data clearly marked) instead of a “You’re all set!” confetti page.",
      "Desktop: centered column max-w-[480px]–[560px] or a split with a product preview on the right.",
    ],
    numbers: [
      "Headline 24–32px mobile, 32–40px desktop; supporting text ≤ 2 lines, 15–17px.",
      "Choice cards 56–72px tall, 12–16px gap, selected = accent border 2px + check icon.",
      "Primary button pinned to the bottom on mobile (inset 16–20px, 52–56px tall).",
      "Illustration area ≤ 45% of the viewport height.",
    ],
    density: {
      guided: "One question per screen — consumer.",
      compact: "Single page checklist with 3–5 tasks — B2B tools.",
    },
    states: [
      "Selected/unselected choices, disabled continue until valid.",
      "Permission request with rationale before the system prompt.",
      "Skip path and resume later.",
      "Error (e.g. invite failed) without losing progress.",
    ],
    failures: [
      "Five feature-tour carousels before anything useful.",
      "Generic illustrations of people high-fiving.",
      "Asking for data the product does not use yet.",
      "No way back or skip.",
    ],
  },
];

const byId = new Map(playbooks.map((p) => [p.id, p]));

export function getPlaybook(domain) {
  if (!domain) return null;
  const key = String(domain).toLowerCase().trim();
  return (
    byId.get(key) ||
    playbooks.find((p) => p.aliases.includes(key)) ||
    playbooks.find((p) => p.aliases.some((a) => key.includes(a))) ||
    null
  );
}

export function listPlaybooks() {
  return playbooks.map(({ id, name, viewports, aliases }) => ({
    id,
    name,
    viewports: viewports.map((v) => `${v.width}×${v.height}`),
    aliases,
  }));
}

export function playbookMarkdown(p) {
  const list = (items) => items.map((i) => `- ${i}`).join("\n");
  return `# Playbook: ${p.name} (\`${p.id}\`)

**Canonical viewports:** ${p.viewports.map((v) => `${v.name} ${v.width}×${v.height}`).join(", ")}

## Structure
${list(p.structure)}

## Numbers
${list(p.numbers)}

## Density modes
${list(Object.entries(p.density).map(([k, v]) => `**${k}** — ${v}`))}

## Must-have states
${list(p.states)}

## Small edits
For small text or class edits, read get_element_code and use replace_in_element with an exact old string that occurs once, the replacement new string, and the current read_document revision. Keep descendant data-node-id attributes. On conflict read again; use update_elements for structural edits.

## Common failures
${list(p.failures)}
`;
}
