# get_design_guidelines: tool schema and style catalog

Captured live 2026-10-30 (Wonder 0.2.190) by having the Wonder app agent call the tools; schemas come from the `deferred_tools_record` attachment in that session transcript.

## Tool definitions (verbatim)

```json
{
  "name": "mcp__wonder__get_design_guidelines",
  "description": "Returns the design fundamentals and, with style, one style's detailed guidelines. Call it when the call that opened the task did not include the fundamentals, or once you have chosen a style. Styles: academia, art-deco, bauhaus, bold-typography, botanical, claymorphism, cyberpunk, enterprise, flat-design, glassmorphism, industrial, kinetic, luxury, material-design, maximalism, minimal-dark, modern-dark, monochrome, neo-brutalism, neumorphism, newsprint, organic, playful-geometric, professional, retro, saas, sketch, swiss-minimalist, terminal, vaporwave, web3.",
  "input_schema": {
    "type": "object",
    "properties": {
      "style": {
        "description": "Optional. A design style to layer on the fundamentals, one of the styles get_design_guidelines lists; omit it until the user's brief names a look or you have picked one. When omitted, only the fundamentals are returned.",
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "eager_input_streaming": true,
  "defer_loading": true
}
```

```json
{
  "name": "mcp__wonder__get_skills",
  "description": "Loads the instructions for one design job. Call it before a design task, including building a design in code, with the skill that matches:\n\n- code-to-design: bring a screen or component from the user's code onto the canvas, or refresh one after the code changed.\n- design-to-code: build a canvas design in the user's code.\n- new-design: design a new screen, component, set of items or variations from a prompt.\n- edit-design: change, fix or give feedback on an existing design beyond a quick text, color, spacing or icon tweak.\n- design-library: create or change the file's design tokens or icon library.\n- generate-assets: generate an image or an SVG, or vectorize an image.\n\nA skill names the supporting skills it needs; load one by name when the work reaches it.",
  "input_schema": {
    "type": "object",
    "properties": {
      "skill": {
        "description": "The skill to load, such as 'new-design' or 'code-to-design', or a supporting skill one of them names.",
        "type": "string"
      }
    },
    "additionalProperties": false
  },
  "eager_input_streaming": true,
  "defer_loading": true
}
```

## Result of `get_design_guidelines {}` (no style)

There is no separate catalog result: with no `style` the tool returns only the Design Fundamentals, byte-identical to `01-design-fundamentals.md` (13067 chars). The style list exists only in the tool description above.

With a `style`, the result is the same fundamentals text, then `\n\n---\n\n`, then that style's section. The style sections are in `06-design-styles/<slug>.md`.

## Styles (31)

The slug list is verbatim from the tool description. Title and first line are taken from each style's own section; the server sends no separate description per style.

| Slug                | Title in guideline        | First line                                                                                                                                                                                                               | Section chars |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `academia`          | Academia / Classical      | A physical university library rendered on screen: aged parchment, dark mahogany, polished brass and crimson leather, set in traditional book typography with measured ornament.                                          | 3401          |
| `art-deco`          | Art Deco                  | The Roaring Twenties as an interface: Gatsby opulence with skyscraper geometry.                                                                                                                                          | 4002          |
| `bauhaus`           | Bauhaus                   | A 1920s Bauhaus poster as an interface: every element composed from circles, squares and triangles, thick deliberate borders, pure primaries on stark black and white.                                                   | 3675          |
| `bold-typography`   | Bold Typography           | Poster design translated to the web: type is the whole visual language.                                                                                                                                                  | 2970          |
| `botanical`         | Botanical / Organic Serif | A botanical garden, a ceramics studio and an editorial spread in one: soft, tactile, artisanal, the calm of high-end wellness and sustainable luxury.                                                                    | 2656          |
| `claymorphism`      | Claymorphism              | A world made of premium digital clay: matte vinyl-toy surfaces that absorb light, dense and squeezable, floating with weight over a cool lavender ground.                                                                | 3768          |
| `cyberpunk`         | Cyberpunk / Glitch        | "High-tech, low-life": a hacked feed on a malfunctioning CRT in a rain-soaked megacity.                                                                                                                                  | 4595          |
| `enterprise`        | Corporate Trust           | Modern enterprise SaaS that feels approachable rather than cold, in the manner of the tech unicorns that humanized corporate software.                                                                                   | 3532          |
| `flat-design`       | Flat Design               | Confident reduction: no shadows, bevels, realistic gradients or textures, so hierarchy comes entirely from size, color and type.                                                                                         | 2736          |
| `glassmorphism`     | Glassmorphism             | Depth through layered translucency: frosted surfaces that filter saturated color beneath them, like macOS Control Center or a dashboard floating in space.                                                               | 4324          |
| `industrial`        | Industrial Skeuomorphism  | An interface that feels like a machine: Dieter Rams clarity with Teenage Engineering playfulness.                                                                                                                        | 5145          |
| `kinetic`           | Kinetic Typography        | Typography is the entire structure: text becomes image and the headline is the hero.                                                                                                                                     | 3163          |
| `luxury`            | Luxury / Editorial        | A high-end fashion magazine or a luxury house website (Vogue, Kinfolk, Aesop): exquisite type at dramatic scale, more negative space than feels comfortable, and intentional asymmetry that keeps architectural balance. | 3304          |
| `material-design`   | Material You              | Material You (Material Design 3): an organic, expressive system where tonal palettes from one seed color replace stark white, blurred organic shapes replace flat geometry, and pill buttons define the silhouette.      | 3303          |
| `maximalism`        | Maximalism / Dopamine     | More is more: sensory abundance, clashing patterns, screaming color and joyful overlap, a Lisa Frank fever dream crossed with hyperpop album art.                                                                        | 4662          |
| `minimal-dark`      | Minimalist Dark           | Atmospheric depth from layers of darkness, with warm amber glowing like embers: the visual language of premium dark-mode tools such as Linear, Raycast and Vercel.                                                       | 4003          |
| `modern-dark`       | Modern Dark               | Premium developer tools (Linear, Vercel, Raycast): obsessively crafted, nearly monochrome, every surface in three-dimensional space under soft ambient light, with one saturated indigo accent.                          | 5253          |
| `monochrome`        | Minimalist Monochrome     | Reduction to essence: black, white and typography, in the manner of fashion editorials, architectural monographs and museum catalogues (Chanel, Celine, Bottega Veneta).                                                 | 3711          |
| `neo-brutalism`     | Neo-Brutalism             | A punk rebellion against polished SaaS: raw structure with Pop Art saturation, early-internet sticker culture and zine spirit.                                                                                           | 4169          |
| `neumorphism`       | Neumorphism Soft UI       | Soft UI: elements look molded from one continuous surface of matte clay, either extruding from it or pressed into it, lit from the top-left.                                                                             | 2510          |
| `newsprint`         | Newsprint                 | "All the news that's fit to print": the golden age of print journalism made digital.                                                                                                                                     | 3932          |
| `organic`           | Organic / Natural         | Wabi-sabi made digital: the acceptance of imperfection and transience.                                                                                                                                                   | 3485          |
| `playful-geometric` | Playful Geometric         | "Stable grid, wild decoration": the Memphis Group cleaned up for modern screens.                                                                                                                                         | 3846          |
| `professional`      | Serif                     | Typographic elegance through classical restraint, like a literary magazine or a premium architecture journal.                                                                                                            | 3150          |
| `retro`             | Retro / 90s Nostalgia     | The early web, unfiltered: GeoCities pages, "Under Construction" banners, hit counters and Windows 95 chrome, crafted as if in 1997.                                                                                     | 4311          |
| `saas`              | Minimalist Modern SaaS    | Clarity through structure, character through bold detail: high-tech SaaS precision crossed with a creative agency's portfolio.                                                                                           | 4434          |
| `sketch`            | Hand-Drawn / Sketch       | Authentic imperfection: sketches on paper, sticky notes on a wall, a napkin diagram from a brainstorm.                                                                                                                   | 3632          |
| `swiss-minimalist`  | Swiss International Style | The International Typographic Style of 1950s Switzerland: objective communication, mathematical precision and logical structure.                                                                                         | 3700          |
| `terminal`          | Terminal CLI              | The command line as a design language: brutally functional, high-contrast and authentically retro, like configuring a server in a clean ZSH or Bash shell (not Matrix rain).                                             | 2945          |
| `vaporwave`         | Vaporwave / Outrun        | 1980s retro-futurism drenched in neon: perspective grids receding to the horizon, CRT scanlines, a blurred sunset sun and glowing everything, like commanding a vintage terminal in the year 2088.                       | 4447          |
| `web3`              | Bitcoin DeFi / Web3       | Precision engineering, cryptographic trust and digital gold: a cosmic void where data structures glow with Bitcoin-orange warmth, like mining rigs humming in the dark.                                                  | 4764          |
