---
name: "skill-hunter"
description: "Search everywhere for a Claude skill matching a need: installed skills, org catalog, plugins, skills.sh, GitHub and community lists, then rank by trust and fit."
---

# Skill Hunter

Find the best existing Claude skill (or plugin/connector) for what the user wants, searching every source rather than one registry. Never stop after one empty source: an empty result usually means that source was unreachable or the keyword was wrong.

## 1. Turn the request into keywords
From the user's need (e.g. "poster design"), write 4-6 search terms:
- the literal term (poster)
- synonyms (flyer, banner, graphic, print design)
- the output format (png, pdf, canvas, svg)
- the broader category (design, marketing, social media)
- any tool named (Canva, Figma, Remotion)

## 2. Search sources in this order (run independent searches in parallel)

**A. Already available to the user (best: zero install)**
- Check the skills listed in the current session's available-skills list for matching names/descriptions.
- `ListSkills` / `SearchSkills` (load via ToolSearch) with the keywords.
- `SuggestSkills` with trigger "user_asked" for org/shared/Anthropic skills not yet enabled.
- `SearchPlugins` for org plugin bundles that contain skills.
- `SearchMcpRegistry` in case a connector (Canva, Adobe, Figma...) covers the need better than a skill.

**B. Public skill registry**
- Try `npx -y skills find <keyword>` once per keyword. If every keyword (even a generic one like "design") returns nothing, the registry is unreachable from this workspace: stop retrying the CLI and move on.
- `WebSearch` with `site:skills.sh <keyword>` and `skills.sh <keyword> skill`; `WebFetch` promising skills.sh pages to read install counts.

**C. GitHub**
- `WebSearch`: `"SKILL.md" <keyword> github`, `claude skill <keyword> github`, `agent skills <keyword>`.
- Check known collections: github.com/anthropics/skills, github.com/vercel-labs/agent-skills, github.com/ComposioHQ/awesome-claude-skills, and other "awesome-claude-skills" / "awesome agent skills" lists. WebFetch the README and scan for the keywords.
- `gh search repos "<keyword> claude skill"` and `gh search code "<keyword>" --filename SKILL.md` if gh works.

**D. Community**
- `WebSearch`: `claude skills <keyword> reddit`, `claude code skill <keyword>`, recent blog posts or newsletters listing skills.

Use "standard" search mode first; switch to "extended" only if results are thin.

## 3. Vet each candidate before recommending
Open the actual SKILL.md (WebFetch the raw GitHub file) and check:
- It really does the task (read the description and body, not just the title).
- Source trust: Anthropic / Vercel / Microsoft / the tool's own vendor > well-starred repos (100+ stars) > unknown authors.
- Install count on skills.sh (prefer 1K+; flag anything under 100).
- Recently maintained.
- Safety: flag any skill whose scripts download and run remote code, ask for credentials, or send data to unknown endpoints. Never install or run those without the user's explicit OK.

## 4. Report
Reply in chat, short, ranked best-first, grouped:
1. **Ready now** - already installed/connected; say how to use it.
2. **One click** - org/Anthropic skills, plugins or connectors (render the SuggestSkills / SuggestPluginInstall / SuggestConnectors card instead of describing them).
3. **Install from the web** - name, what it does, source + stars/installs, link, and the install command (`npx skills add owner/repo@skill`) or note that it can be uploaded as a skill in Claude settings.

Include a short "Sources:" list of links. If a source was unreachable, say so in one line.

## 5. If nothing fits
Say so plainly, offer to do the task directly, and offer to build a custom skill for it (skill-creator or propose_skills).

## 6. Installing
Only install when the user says to. Read the whole SKILL.md and any scripts first; mention anything risky before installing.
