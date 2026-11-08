// Verynize — design knowledge layer.
// Fundamentals, the named design styles, the older Verynize archetypes, domain playbooks, job-routed
// skills and the agent persona.

import { fundamentals } from "./fundamentals.mjs";
import {
  styles,
  styleIds,
  listStyles,
  getStyle,
  pickStyle,
  styleTokens,
  styleMarkdown,
} from "./styles/index.mjs";
import {
  archetypes,
  listArchetypes,
  getArchetype,
  pickArchetype,
  archetypeTokens,
  archetypeMarkdown,
} from "./archetypes.mjs";
import { playbooks, getPlaybook, listPlaybooks, playbookMarkdown } from "./playbooks.mjs";
import {
  skills,
  skillAliases,
  resolveSkillName,
  getSkill,
  listSkills,
  skillCatalog,
} from "./skills.mjs";
import { persona } from "./persona.mjs";
import { contrastRatio, relativeLuminance } from "./color.mjs";

/**
 * Resolve a style name: the named styles first, then the additional Verynize archetypes.
 * @returns {{ kind: 'style', id: string, style: object } | { kind: 'archetype', id: string, archetype: object } | null}
 */
export function resolveStyle(idOrName) {
  if (!idOrName) return null;
  const s = getStyle(idOrName);
  if (s) return { kind: "style", id: s.id, style: s };
  const a = getArchetype(idOrName);
  if (a) return { kind: "archetype", id: a.id, archetype: a };
  return null;
}

/** Token objects for a style slug or archetype id (same shape either way, plus `kind`). */
export function designTokens(idOrName) {
  const found = resolveStyle(idOrName);
  if (!found)
    throw new Error(
      `Unknown style "${idOrName}". Styles: ${styleIds.join(", ")}. Additional Verynize archetypes: ${archetypes.map((a) => a.id).join(", ")}.`,
    );
  return found.kind === "style"
    ? { kind: "style", ...styleTokens(found.id) }
    : { kind: "archetype", style: found.id, ...archetypeTokens(found.id) };
}

/**
 * Guidelines for a design job. Fundamentals are always included. Compose the output as
 * fundamentals, then '\n\n---\n\n', then styleSection, then playbook (when a domain was given), then notes.
 * @param {{ style?: string, domain?: string, brief?: string }} [options]
 *   style = one of the named style slugs (or its display name); an archetype id or name is accepted as a fallback.
 *   domain = playbook id or alias. brief = free text; returns style suggestions.
 * @returns {{
 *   fundamentals: string,
 *   styleSection?: string, styleId?: string, styleKind?: 'style'|'archetype',
 *   archetype?: string,          // same markdown as styleSection when the style resolved to an archetype
 *   playbook?: string, playbookId?: string,
 *   suggestions?: { id: string, name: string, score: number, why: string }[],
 *   archetypeSuggestions?: { id: string, name: string, score: number, why: string }[],
 *   notes: string[],
 * }}
 */
export function getDesignGuidelines({ style, domain, brief } = {}) {
  const out = { fundamentals, notes: [] };
  if (style) {
    const found = resolveStyle(style);
    if (found?.kind === "style")
      Object.assign(out, {
        styleKind: "style",
        styleId: found.id,
        styleSection: styleMarkdown(found.style),
      });
    else if (found?.kind === "archetype") {
      const md = archetypeMarkdown(found.archetype);
      Object.assign(out, {
        styleKind: "archetype",
        styleId: found.id,
        styleSection: md,
        archetype: md,
      });
    } else
      out.notes.push(
        `Unknown style "${style}". Valid style slugs: ${styleIds.join(", ")}. Additional Verynize archetype ids are also accepted: ${archetypes.map((a) => a.id).join(", ")}.`,
      );
  }
  if (domain) {
    const p = getPlaybook(domain);
    if (p) Object.assign(out, { playbook: playbookMarkdown(p), playbookId: p.id });
    else
      out.notes.push(
        `Unknown domain "${domain}". Available: ${playbooks.map((x) => x.id).join(", ")}.`,
      );
  }
  if (brief) {
    out.suggestions = pickStyle(brief);
    out.archetypeSuggestions = pickArchetype(brief);
  }
  if (!style)
    out.notes.push(
      `No style chosen yet. Pick the one that fits the brief${brief ? " from the suggestions" : " (pass brief to get suggestions)"}, or follow the document's existing tokens, then ask again with style. Styles: ${styleIds.join(", ")}.`,
    );
  return out;
}

export {
  fundamentals,
  styles,
  styleIds,
  listStyles,
  getStyle,
  pickStyle,
  styleTokens,
  styleMarkdown,
  archetypes,
  listArchetypes,
  getArchetype,
  pickArchetype,
  archetypeTokens,
  archetypeMarkdown,
  playbooks,
  getPlaybook,
  listPlaybooks,
  playbookMarkdown,
  skills,
  skillAliases,
  resolveSkillName,
  getSkill,
  listSkills,
  skillCatalog,
  persona,
  contrastRatio,
  relativeLuminance,
};
