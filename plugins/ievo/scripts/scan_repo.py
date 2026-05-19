#!/usr/bin/env python3
"""scan_repo.py — deterministic repo scanner for iEvo.

Clones a GitHub repo shallowly, enumerates Claude Code skills/agents/plugins,
extracts heuristic security signals, and writes two artifacts:

  <output_dir>/<owner>-<repo>.md       — index file (matches _TEMPLATE.md format)
  <output_dir>/<owner>-<repo>.json     — manifest entry update (stats, sha, risk_tier)

Usage:
  scan_repo.py <owner>/<repo> [--output-dir <dir>] [--checkout-dir <dir>] [--force-refresh]

Pure stdlib. No LLM. Designed to be called from:
  - `index-repos` skill (via Bash) for local-context indexing
  - `ievo-ai/community-index` GHA workflow for centralized indexing

Both call sites get identical output. Single source of truth for the algorithm.
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_VERSION = "1.0.0"
TTL_SECONDS = 7 * 24 * 3600  # 7-day TTL for checkout cache


# ---------------------------------------------------------------------------
# git ops
# ---------------------------------------------------------------------------


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> str:
    """Run a subprocess command, return stdout. Raises on nonzero exit if check=True."""
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, check=check
    )
    return result.stdout.strip()


def checkout_or_refresh(owner_repo: str, checkout_dir: Path, force: bool = False) -> Path:
    """Ensure a shallow checkout exists at checkout_dir/<owner>-<repo>/. Refresh if stale or forced."""
    safe_name = owner_repo.replace("/", "-")
    target = checkout_dir / safe_name

    if target.exists():
        head_file = target / ".git" / "HEAD"
        if head_file.exists() and not force:
            age = datetime.datetime.now().timestamp() - head_file.stat().st_mtime
            if age < TTL_SECONDS:
                return target  # cache hit, fresh

        # Refresh
        try:
            run(["git", "fetch", "--depth=1"], cwd=target)
            run(["git", "reset", "--hard", "origin/HEAD"], cwd=target)
        except subprocess.CalledProcessError:
            # Network failure with stale checkout — use as is
            return target
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://github.com/{owner_repo}.git"
        run(["git", "clone", "--depth=1", url, str(target)])

    return target


def get_commit_sha(repo: Path) -> str:
    return run(["git", "rev-parse", "--short", "HEAD"], cwd=repo)


def get_last_commit_date(repo: Path) -> str:
    return run(["git", "log", "-1", "--format=%cI", "HEAD"], cwd=repo)[:10]


def get_default_branch(repo: Path) -> str:
    try:
        return run(["git", "symbolic-ref", "--short", "HEAD"], cwd=repo)
    except subprocess.CalledProcessError:
        return "main"


def count_recent_commits(repo: Path, since_date: str) -> int:
    """Count commits since the given ISO date (YYYY-MM-DD)."""
    output = run(
        ["git", "log", f"--since={since_date}", "--oneline"], cwd=repo, check=False
    )
    return len([line for line in output.splitlines() if line.strip()])


# ---------------------------------------------------------------------------
# frontmatter
# ---------------------------------------------------------------------------


FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_frontmatter(file_path: Path) -> dict[str, Any]:
    """Parse YAML frontmatter from an md file. Returns dict of top-level scalar fields."""
    if not file_path.exists():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return {}

    m = FRONTMATTER_RE.match(content)
    if not m:
        return {}

    fm = {}
    current_key = None
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.match(r"^\s+", line) and current_key:
            # continuation — skip for simplicity (nested fields not extracted)
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if value:
                fm[key] = value.strip("\"'")
                current_key = None
            else:
                current_key = key  # multi-line value follows
    return fm


def truncate(text: str | None, limit: int) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


# ---------------------------------------------------------------------------
# layout detection + enumeration
# ---------------------------------------------------------------------------


def detect_layout(repo: Path) -> str:
    has_plugins = (repo / "plugins").is_dir()
    has_agents = (repo / "agents").is_dir()
    has_skills = (repo / "skills").is_dir()
    has_claude_plugin = (repo / ".claude-plugin").is_dir()

    if has_plugins:
        return "marketplace"
    if has_claude_plugin:
        return "single-plugin"
    if has_skills and has_agents:
        return "mixed"
    if has_skills:
        return "flat-skills"
    if has_agents:
        return "flat-agents"
    return "other"


def enumerate_plugins(repo: Path) -> list[dict[str, Any]]:
    plugins_dir = repo / "plugins"
    if not plugins_dir.is_dir():
        return []
    plugins = []
    for plugin_path in sorted(plugins_dir.iterdir()):
        if not plugin_path.is_dir() or plugin_path.name.startswith("."):
            continue
        plugins.append(enumerate_one_plugin(plugin_path))
    return plugins


def enumerate_one_plugin(plugin_path: Path) -> dict[str, Any]:
    manifest_path = plugin_path / ".claude-plugin" / "plugin.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError:
            pass

    agents = []
    agents_dir = plugin_path / "agents"
    if agents_dir.is_dir():
        for agent_file in sorted(agents_dir.glob("*.md")):
            fm = parse_frontmatter(agent_file)
            agents.append({
                "name": fm.get("name", agent_file.stem),
                "model": fm.get("model", "—"),
                "tools": fm.get("tools", "—"),
                "description": truncate(fm.get("description"), 120),
            })

    skills = []
    skills_dir = plugin_path / "skills"
    if skills_dir.is_dir():
        for skill_path in sorted(skills_dir.iterdir()):
            if not skill_path.is_dir():
                continue
            skill_md = skill_path / "SKILL.md"
            if not skill_md.exists():
                continue
            fm = parse_frontmatter(skill_md)
            has_scripts = (skill_path / "scripts").is_dir()
            has_refs = (skill_path / "references").is_dir()
            allowed_tools = fm.get("allowed-tools", "")
            broad_bash = bool(re.search(r"Bash\(\*\)|Bash\(rm:|Bash\(sudo:|Bash\(curl:", allowed_tools))
            skills.append({
                "name": fm.get("name", skill_path.name),
                "description": truncate(fm.get("description"), 120),
                "has_scripts": has_scripts,
                "has_refs": has_refs,
                "license": fm.get("license", "—"),
                "compatibility": truncate(fm.get("compatibility"), 80) or "any",
                "broad_bash": broad_bash,
            })

    commands = []
    commands_dir = plugin_path / "commands"
    if commands_dir.is_dir():
        for cmd_file in sorted(commands_dir.glob("*.md")):
            fm = parse_frontmatter(cmd_file)
            commands.append({
                "name": cmd_file.stem,
                "description": truncate(fm.get("description"), 120),
            })

    hooks = enumerate_hooks(plugin_path / "hooks" / "hooks.json")
    mcp = enumerate_mcp(plugin_path / ".mcp.json")

    return {
        "name": plugin_path.name,
        "description": truncate(manifest.get("description"), 200),
        "version": manifest.get("version", "unset"),
        "path": f"plugins/{plugin_path.name}/",
        "author": manifest.get("author", {}).get("name", "—") if isinstance(manifest.get("author"), dict) else "—",
        "license": manifest.get("license", "—"),
        "agents": agents,
        "skills": skills,
        "commands": commands,
        "hooks": hooks,
        "mcp": mcp,
    }


def enumerate_hooks(hooks_json_path: Path) -> dict[str, Any]:
    if not hooks_json_path.exists():
        return {"present": False, "events": [], "entries": []}
    try:
        data = json.loads(hooks_json_path.read_text())
    except json.JSONDecodeError:
        return {"present": False, "events": [], "entries": []}

    hooks = data.get("hooks", {})
    events = list(hooks.keys())
    entries = []
    for event, hook_list in hooks.items():
        for h in hook_list if isinstance(hook_list, list) else []:
            matcher = h.get("matcher", "—")
            cmd = "—"
            inner_hooks = h.get("hooks", [])
            if inner_hooks:
                first = inner_hooks[0]
                cmd = first.get("command", first.get("type", "—"))
            risk = compute_hook_risk(event, matcher)
            entries.append({
                "event": event,
                "matcher": matcher,
                "command": truncate(cmd, 80),
                "risk": risk,
            })
    return {
        "present": True,
        "events": events,
        "entries": entries,
        "has_pretooluse": "PreToolUse" in events,
        "has_userpromptsubmit": "UserPromptSubmit" in events,
        "has_posttooluse": "PostToolUse" in events,
    }


def compute_hook_risk(event: str, matcher: str) -> str:
    if event in ("PreToolUse", "UserPromptSubmit"):
        return "RED"
    if event == "PostToolUse":
        return "YELLOW"
    return "YELLOW"  # any non-tool-intercepting hook = YELLOW by default


def enumerate_mcp(mcp_json_path: Path) -> dict[str, Any]:
    if not mcp_json_path.exists():
        return {"present": False, "servers": []}
    try:
        data = json.loads(mcp_json_path.read_text())
    except json.JSONDecodeError:
        return {"present": False, "servers": []}

    servers = []
    for name, config in data.get("mcpServers", {}).items():
        url = config.get("url", "")
        is_local = bool(re.search(r"localhost|127\.0\.0\.1|::1", url))
        risk = "GREEN" if is_local else "YELLOW"
        servers.append({
            "name": name,
            "endpoint": truncate(url or config.get("command", ""), 80),
            "is_local": is_local,
            "risk": risk,
        })
    return {"present": True, "servers": servers}


def enumerate_standalone_agents(repo: Path) -> list[dict[str, Any]]:
    agents_dir = repo / "agents"
    if not agents_dir.is_dir():
        return []
    out = []
    for f in sorted(agents_dir.glob("*.md")):
        fm = parse_frontmatter(f)
        out.append({
            "name": fm.get("name", f.stem),
            "model": fm.get("model", "—"),
            "tools": fm.get("tools", "—"),
            "description": truncate(fm.get("description"), 120),
            "path": f"agents/{f.name}",
        })
    return out


def enumerate_standalone_skills(repo: Path) -> list[dict[str, Any]]:
    skills_dir = repo / "skills"
    if not skills_dir.is_dir():
        return []
    out = []
    # Try flat first
    for skill_path in sorted(skills_dir.iterdir()):
        if not skill_path.is_dir():
            continue
        skill_md = skill_path / "SKILL.md"
        if not skill_md.exists():
            # Try one level of category nesting
            for sub in sorted(skill_path.iterdir()):
                if sub.is_dir() and (sub / "SKILL.md").exists():
                    fm = parse_frontmatter(sub / "SKILL.md")
                    out.append({
                        "name": fm.get("name", sub.name),
                        "description": truncate(fm.get("description"), 120),
                        "license": fm.get("license", "—"),
                        "compatibility": truncate(fm.get("compatibility"), 80) or "any",
                        "path": f"skills/{skill_path.name}/{sub.name}/SKILL.md",
                    })
            continue
        fm = parse_frontmatter(skill_md)
        out.append({
            "name": fm.get("name", skill_path.name),
            "description": truncate(fm.get("description"), 120),
            "license": fm.get("license", "—"),
            "compatibility": truncate(fm.get("compatibility"), 80) or "any",
            "path": f"skills/{skill_path.name}/SKILL.md",
        })
    return out


def enumerate_standalone_commands(repo: Path) -> list[dict[str, Any]]:
    commands_dir = repo / "commands"
    if not commands_dir.is_dir():
        return []
    out = []
    for f in sorted(commands_dir.glob("*.md")):
        fm = parse_frontmatter(f)
        out.append({
            "name": f.stem,
            "description": truncate(fm.get("description"), 120),
            "path": f"commands/{f.name}",
        })
    return out


# ---------------------------------------------------------------------------
# risk aggregation
# ---------------------------------------------------------------------------


TRUSTED_OWNERS = {
    "anthropics", "vercel-labs", "wshobson", "microsoft", "github",
    "ievo-ai", "openai",
}


def compute_risk_tier(owner: str, stars: int, plugins: list[dict], has_license: bool) -> str:
    if owner in TRUSTED_OWNERS or stars >= 1000:
        # Even trusted authors get a check
        risky_hooks = any(
            (p.get("hooks", {}).get("has_pretooluse") or p.get("hooks", {}).get("has_userpromptsubmit"))
            for p in plugins
        )
        if risky_hooks:
            return "caution"
        return "trusted"
    if not has_license or stars < 10:
        return "caution"
    return "neutral"


# ---------------------------------------------------------------------------
# markdown rendering
# ---------------------------------------------------------------------------


def render_index_md(data: dict[str, Any]) -> str:
    lines = []
    owner_repo = data["owner_repo"]
    lines.append(f"# `{owner_repo}` — community index")
    lines.append("")
    lines.append(f"> Scanner: ievo-ai/community-index-bot v{SCRIPT_VERSION}")
    lines.append(f"> Scanned: {data['scanned_at']}")
    lines.append(f"> Commit SHA: {data['commit_sha']}")
    lines.append(f"> Default branch: {data['default_branch']}")
    lines.append(f"> Layout: {data['layout']}")
    lines.append("")
    lines.append("## Repo metadata")
    lines.append(f"- **Description:** {truncate(data.get('description'), 200) or '—'}")
    lines.append(f"- **License:** {data.get('license') or 'missing'}")
    lines.append(f"- **Stars:** {data.get('stars', 'unknown')}")
    lines.append(f"- **Created:** {data.get('created') or 'unknown'}")
    lines.append(f"- **Last commit:** {data.get('last_commit_date')}")
    rc = data.get("recent_commits", {})
    if rc:
        lines.append(f"- **Recent commits:** {rc['count']} commits between {rc['from']} and {rc['to']}")
    lines.append("")
    lines.append("## Risk signals (preliminary)")
    lines.append("")
    lines.append("> Heuristic indicators. Full security audit happens per-item via `/ievo:security-check` before install.")
    lines.append("")
    lines.append(f"- **Trust tier:** {data['risk_tier']}")
    plugins = data["plugins"]
    total_hooks = sum(len(p.get("hooks", {}).get("entries", [])) for p in plugins)
    plugins_with_pretool = [p["name"] for p in plugins if p.get("hooks", {}).get("has_pretooluse")]
    plugins_with_userpr = [p["name"] for p in plugins if p.get("hooks", {}).get("has_userpromptsubmit")]
    lines.append(f"- **Hooks total:** {total_hooks} across {sum(1 for p in plugins if p.get('hooks', {}).get('present'))} plugins")
    lines.append(f"  - PreToolUse: {'yes — ' + ', '.join(plugins_with_pretool) if plugins_with_pretool else 'no'}")
    lines.append(f"  - UserPromptSubmit: {'yes — ' + ', '.join(plugins_with_userpr) if plugins_with_userpr else 'no'}")
    total_mcp = sum(len(p.get("mcp", {}).get("servers", [])) for p in plugins)
    lines.append(f"- **MCP servers total:** {total_mcp}")
    broad_skills = []
    for p in plugins:
        for s in p.get("skills", []):
            if s.get("broad_bash"):
                broad_skills.append(f"{p['name']}/{s['name']}")
    lines.append(f"- **Skills with broad allowed-tools:** {len(broad_skills)}{' — ' + ', '.join(broad_skills) if broad_skills else ''}")
    lines.append("")

    if plugins:
        lines.append(f"## Plugins ({len(plugins)})")
        lines.append("")
        for p in plugins:
            lines.append(f"### {p['name']}")
            lines.append(f"- **Description:** {p['description'] or '—'}")
            lines.append(f"- **Version:** {p['version']}")
            lines.append(f"- **Path:** `{p['path']}`")
            lines.append(f"- **Author:** {p['author']}")
            lines.append(f"- **License:** {p['license']}")
            lines.append("")
            if p["agents"]:
                lines.append(f"**Agents ({len(p['agents'])}):**")
                lines.append("")
                lines.append("| Name | Model | Tools | Description |")
                lines.append("|------|-------|-------|-------------|")
                for a in p["agents"]:
                    lines.append(f"| {a['name']} | {a['model']} | {a['tools']} | {a['description'] or '—'} |")
                lines.append("")
            if p["skills"]:
                lines.append(f"**Skills ({len(p['skills'])}):**")
                lines.append("")
                lines.append("| Name | Description | Has scripts | License | Compat |")
                lines.append("|------|-------------|-------------|---------|--------|")
                for s in p["skills"]:
                    desc = (s['description'] or '—') + (" — Bash(broad) RED" if s.get("broad_bash") else "")
                    lines.append(f"| {s['name']} | {desc} | {'yes' if s['has_scripts'] else 'no'} | {s['license']} | {s['compatibility']} |")
                lines.append("")
            if p["commands"]:
                lines.append(f"**Commands ({len(p['commands'])}):**")
                lines.append("")
                lines.append("| Name | Description |")
                lines.append("|------|-------------|")
                for c in p["commands"]:
                    lines.append(f"| {c['name']} | {c['description'] or '—'} |")
                lines.append("")
            hooks = p.get("hooks", {})
            if hooks.get("present") and hooks.get("entries"):
                lines.append("**Hooks:**")
                lines.append("")
                lines.append("| Event | Matcher | Command | Risk |")
                lines.append("|-------|---------|---------|------|")
                for h in hooks["entries"]:
                    lines.append(f"| {h['event']} | {h['matcher']} | `{h['command']}` | {h['risk']} |")
                lines.append("")
            mcp = p.get("mcp", {})
            if mcp.get("present") and mcp.get("servers"):
                lines.append("**MCP servers:**")
                lines.append("")
                lines.append("| Name | Endpoint | Risk |")
                lines.append("|------|----------|------|")
                for m in mcp["servers"]:
                    lines.append(f"| {m['name']} | `{m['endpoint']}` | {m['risk']} |")
                lines.append("")

    sa = data["standalone_agents"]
    if sa:
        lines.append(f"## Standalone agents ({len(sa)})")
        lines.append("")
        lines.append("| Name | Model | Tools | Description | Path |")
        lines.append("|------|-------|-------|-------------|------|")
        for a in sa:
            lines.append(f"| {a['name']} | {a['model']} | {a['tools']} | {a['description'] or '—'} | `{a['path']}` |")
        lines.append("")

    ss = data["standalone_skills"]
    if ss:
        lines.append(f"## Standalone skills ({len(ss)})")
        lines.append("")
        lines.append("| Name | Description | License | Compat | Path |")
        lines.append("|------|-------------|---------|--------|------|")
        for s in ss:
            lines.append(f"| {s['name']} | {s['description'] or '—'} | {s['license']} | {s['compatibility']} | `{s['path']}` |")
        lines.append("")

    sc = data["standalone_commands"]
    if sc:
        lines.append(f"## Standalone commands ({len(sc)})")
        lines.append("")
        lines.append("| Name | Description | Path |")
        lines.append("|------|-------------|------|")
        for c in sc:
            lines.append(f"| {c['name']} | {c['description'] or '—'} | `{c['path']}` |")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="iEvo deterministic repo scanner")
    parser.add_argument("repo", help="<owner>/<repo>")
    parser.add_argument("--output-dir", default=".", help="Where to write <repo>.md and <repo>.json")
    parser.add_argument("--checkout-dir", default=str(Path.home() / ".ievo" / "checkouts"))
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    if "/" not in args.repo:
        print(f"Error: repo must be in <owner>/<repo> format, got '{args.repo}'", file=sys.stderr)
        sys.exit(1)

    owner, name = args.repo.split("/", 1)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    checkout_dir = Path(args.checkout_dir)

    try:
        repo = checkout_or_refresh(args.repo, checkout_dir, args.force_refresh)
    except subprocess.CalledProcessError as exc:
        print(f"Failed to clone {args.repo}: {exc}", file=sys.stderr)
        sys.exit(2)

    commit_sha = get_commit_sha(repo)
    last_commit = get_last_commit_date(repo)
    default_branch = get_default_branch(repo)
    layout = detect_layout(repo)

    now = datetime.datetime.now(datetime.timezone.utc)
    scanned_at = now.isoformat(timespec="seconds")
    thirty_days_ago = (now - datetime.timedelta(days=30)).date().isoformat()
    recent_count = count_recent_commits(repo, thirty_days_ago)

    plugins = enumerate_plugins(repo)
    standalone_agents = enumerate_standalone_agents(repo)
    standalone_skills = enumerate_standalone_skills(repo)
    standalone_commands = enumerate_standalone_commands(repo)

    license_file_exists = any((repo / fname).exists() for fname in ("LICENSE", "LICENSE.md", "LICENSE.txt"))
    # Stars + GitHub description require gh api — skip for MVP (deterministic-only)
    risk_tier = compute_risk_tier(owner, stars=0, plugins=plugins, has_license=license_file_exists)
    has_hooks = any(p.get("hooks", {}).get("present") for p in plugins)
    has_mcp = any(p.get("mcp", {}).get("present") for p in plugins)

    data = {
        "owner_repo": args.repo,
        "scanned_at": scanned_at,
        "commit_sha": commit_sha,
        "default_branch": default_branch,
        "layout": layout,
        "last_commit_date": last_commit,
        "recent_commits": {
            "count": recent_count,
            "from": thirty_days_ago,
            "to": now.date().isoformat(),
        },
        "license": "MIT" if license_file_exists else None,
        "risk_tier": risk_tier,
        "plugins": plugins,
        "standalone_agents": standalone_agents,
        "standalone_skills": standalone_skills,
        "standalone_commands": standalone_commands,
    }

    safe_name = args.repo.replace("/", "-")
    md_out = output_dir / f"{safe_name}.md"
    md_out.write_text(render_index_md(data), encoding="utf-8")

    manifest_entry = {
        "last_scan": scanned_at,
        "scanner_sha": commit_sha,
        "default_branch": default_branch,
        "index_file": f"indices/{safe_name}.md",
        "stats": {
            "plugins": len(plugins),
            "agents": len(standalone_agents) + sum(len(p["agents"]) for p in plugins),
            "skills": len(standalone_skills) + sum(len(p["skills"]) for p in plugins),
        },
        "risk_tier": risk_tier,
        "has_hooks": has_hooks,
        "has_mcp": has_mcp,
    }
    json_out = output_dir / f"{safe_name}.json"
    json_out.write_text(json.dumps(manifest_entry, indent=2), encoding="utf-8")

    # One-line summary on stdout (for caller to collect)
    print(f"{args.repo}: indexed (commit={commit_sha}) — {len(plugins)} plugins, "
          f"{manifest_entry['stats']['agents']} agents, {manifest_entry['stats']['skills']} skills, "
          f"hooks: {'yes' if has_hooks else 'no'}, risk: {risk_tier}")


if __name__ == "__main__":
    main()
