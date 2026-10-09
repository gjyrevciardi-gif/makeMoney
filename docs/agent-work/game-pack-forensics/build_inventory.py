"""Derive structural inventory from pinned Git trees and cached static evidence.

No casino code is executed. SQL is parsed as text, never imported into a database.
Run after audit_files.py acquisition; external source is never copied into output.
"""
import collections
import csv
import hashlib
import json
import pathlib
import re
import subprocess
import sys
from audit_files import REPOS, tree

EMPTY = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
CORE = ("Server.php", "SlotSettings.php", "GameReel.php", "reels.txt")
PROVIDERS = {"Playngo", "Egt", "iSoftBet", "Gamomat", "Playtech", "Amatic", "Aristocrat", "C-Technology", "Greentube", "Igrosoft", "NetEnt", "Novomatic", "Pragmatic", "Skywind", "Mainama", "Ka-Gaming", "Wazdan", "Vision", "Playgt", "CQ9 Gaming", "GD Games", "BetSoft", "NetGame", "Igtech"}
SAMPLES = ["BookOfRaDXGT", "LuckyLadysCharmDX", "SweetBonanza", "GatesofOlympus", "SuperHot40EGT", "BurningHot20EGT", "StarBurstNET", "JumanjiNET", "DolphinReefPT", "BookOfFortuneAM"]

def sql_metadata(path):
    if not path.exists():
        return {}, {}
    text = path.read_text(encoding="utf-8", errors="replace")
    tables = {}
    for table in ("w_categories", "w_games", "w_game_categories"):
        rows = []
        for match in re.finditer(r"INSERT INTO `" + table + r"` \((.*?)\) VALUES\s*\n(.*?);\s*\n", text, re.S):
            columns = re.findall(r"`([^`]+)`", match[1])
            for line in match[2].splitlines():
                line = line.strip().rstrip(",").strip()
                if line.startswith("(") and line.endswith(")"):
                    values = next(csv.reader([line[1:-1]], delimiter=",", quotechar="'", escapechar="\\", skipinitialspace=True))
                    assert len(values) == len(columns), (table, len(values), len(columns))
                    rows.append(dict(zip(columns, values)))
        tables[table] = rows
    categories = {r["id"]: r["title"] for r in tables["w_categories"]}
    game_ids = {r["id"]: r["name"] for r in tables["w_games"]}
    titles = {r["name"]: r["title"] for r in tables["w_games"]}
    mapping = collections.defaultdict(set)
    for row in tables["w_game_categories"]:
        if row["game_id"] in game_ids:
            mapping[game_ids[row["game_id"]]].add(categories.get(row["category_id"], "UNKNOWN_CATEGORY_ID_" + row["category_id"]))
    return mapping, titles

def build(external):
    result = {"schema_version": 1, "audit_date": "2026-09-26", "base_commit": "74c841a61245d4851abf6bba5a82a4873b97e313", "branch": "research/game-pack-forensics", "method": {
        "scope": "Static trees plus representative file-content audit; no server, dependency install, or external code execution.",
        "counts": "Game directory/variant counts, not unique original titles. Embedded subdirectories, skins, thumbnails and launch-only Blade templates are not games.",
        "C": "Backend core files present and nonempty; provisional structural classification, not proof every backend works or has correct math.",
        "F": "Known broken or missing dependencies. Orthogonal flags retain backend/client evidence.",
        "G": "Orthogonal high-risk flag on content-audited games; unaudited games inherit repository risk, not a claim each is individually audited.",
        "provider": "Nonexclusive database game/category joins restricted to real game directories. Repository attribution, not certified original-provider provenance. Generic categories excluded; unknown/multiple mappings retained.",
        "playability": "Not executed; zero verified complete games is also supported by missing local clients or concrete missing boot/assets.",
        "routing": "One Flash child selected as deepseek/deepseek-v4.1-flash; static-ready. Child ended prematurely; root completed static research. Provider inference metadata unavailable; no model switch or further delegation."
    }, "repositories": []}
    for local, remote in REPOS.items():
        root = external / local
        objects = tree(root)
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        evidence = external / "evidence" / local
        sql = "v10.sql" if local.startswith("taxipult") else "betshopme_8.sql"
        provider_map, titles = sql_metadata(evidence / sql)
        groups = collections.defaultdict(list)
        for p in objects:
            if p.startswith("casino/app/Games/") and len(p.split("/")) > 4:
                groups[p.split("/")[3]].append(p)
        games = []
        for name, paths in sorted(groups.items()):
            base = "casino/app/Games/" + name + "/"
            core = {f: base + f for f in CORE if base + f in objects and objects[base + f]["oid"] != EMPTY}
            client = [p for p in paths if p.endswith((".js", ".html", ".xhtml", ".swf"))]
            assets = [p for p in paths if p.endswith((".png", ".jpg", ".jpeg", ".mp3", ".ogg", ".wav", ".atlas"))]
            view = "casino/resources/views/frontend/games/list/" + name + ".blade.php"
            known_broken = name in ("AmericanGigoloCT", "AztecGoldMegawaysISB") and bool(client)
            valid = name != "DelGames"
            inspected = (local.startswith("taxipult") and name in SAMPLES) or known_broken or (local.startswith("promex") and name == "BookOfRaDXGT")
            flags = ["F_MISSING_GAME_CLIENT"] if not client else ["F_CLIENT_DEPENDENCIES_MISSING"]
            if inspected:
                flags.append("G_HIGH_RISK_BACKEND_FAIRNESS")
            if not valid:
                flags = ["F_ORPHAN_SERVER_COPY_WRONG_NAMESPACE"]
            categories = sorted(provider_map.get(name, []))
            provider = sorted(set(categories) & PROVIDERS)
            games.append({"id": name, "title_from_database": titles.get(name), "counted_backend_game_directory": valid,
                "classification": "F" if known_broken or len(core) < len(CORE) else "C", "flags": flags,
                "backend_directory": base.rstrip("/"), "backend_core": core,
                "backend_file_count": sum(p.endswith((".php", ".txt", ".G6")) for p in paths),
                "total_directory_files": len(paths), "frontend_code_files": client, "asset_file_count": len(assets),
                "asset_examples": assets[:5], "launcher_template": view if view in objects else None,
                "expected_public_client_root": "/games/" + name + "/", "expected_public_client_root_in_tree": False,
                "complete_game": False, "playable_local": "NO_AS_CHECKED_IN", "runtime_tested": False,
                "provider_labels": provider, "database_categories": categories,
                "provider_confidence": "MEDIUM_REPOSITORY_DB_MAPPING" if provider else "UNKNOWN",
                "provider_evidence": sql + ": w_games.name -> w_game_categories.game_id/category_id -> w_categories.title" if categories else None,
                "file_content_audit": "DEEP_SAMPLE" if local.startswith("taxipult") and name in SAMPLES else "CLIENT_AND_BACKEND_SAMPLE" if known_broken else "BACKEND_SAMPLE" if inspected else "STRUCTURAL_ONLY",
                "ui_match_likelihood": "MEDIUM" if known_broken else "UNKNOWN",
                "evidence_url": "https://github.com/" + remote + "/tree/" + sha + "/" + base.rstrip("/")})
        arcade = [p for p in objects if p.startswith("casino/PTWebSocket/arcade_server/games/") and p.endswith(".js")]
        loose = [p for p in arcade if pathlib.PurePosixPath(p).stem not in groups]
        actual = [g for g in games if g["counted_backend_game_directory"]]
        providers = collections.Counter(p for g in actual for p in g["provider_labels"])
        checked = []
        for path in evidence.rglob("*") if evidence.exists() else []:
            if path.is_file():
                rel = path.relative_to(evidence).as_posix()
                if rel not in objects:
                    continue
                data = path.read_bytes()
                oid = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                assert oid == objects[rel]["oid"], (local, rel, "evidence content differs from pinned git object")
                checked.append(rel)
        result["repositories"].append({"repository": remote, "commit": sha, "tree_entries": len(objects), "tree_truncated": False,
            "counts": {"raw_backend_directories": len(groups), "actual_backend_game_directories": len(actual),
                "frontend_game_directories_with_code": sum(bool(g["frontend_code_files"]) for g in actual),
                "asset_game_directories": sum(g["asset_file_count"] > 0 for g in actual), "complete_game_directories": 0,
                "launcher_templates": sum(p.startswith("casino/resources/views/frontend/games/list/") for p in objects),
                "arcade_backend_modules": len(arcade), "additional_unmatched_backend_modules": len(loose)},
            "additional_backend_modules": [{"id": pathlib.PurePosixPath(p).stem, "path": p, "classification": "C", "qualification": "Backend module only, no local client; not counted as an app/Games directory"} for p in loose],
            "provider_counts_nonexclusive": dict(sorted(providers.items())),
            "provider_unattributed_game_directories": sum(not g["provider_labels"] for g in actual),
            "provider_multiple_game_directories": sum(len(g["provider_labels"]) > 1 for g in actual),
            "class_counts_raw_directories": {c: sum(g["classification"] == c for g in games) for c in "ABCDEF"},
            "empty_game_files": [p for p,v in objects.items() if p.startswith("casino/app/Games/") and v["oid"] == EMPTY],
            "submodules": [p for p,v in objects.items() if v["mode"] == "160000"],
            "symlinks": [p for p,v in objects.items() if v["mode"] == "120000"],
            "native_binaries": [p for p in objects if p.lower().endswith((".exe", ".dll", ".so"))],
            "content_audited_file_count": len(checked), "content_git_oid_verified": True,
            "security_risk": "HIGH" if actual else "MEDIUM", "verdict": "REFERENCE_ONLY" if actual else "REJECT", "games": games})
    result["sample_audits"] = []
    source = external / "evidence" / "taxipult-goldsvet"
    for name in SAMPLES:
        folder = source / "casino/app/Games" / name
        rng = []
        fairness = []
        for path in folder.rglob("*.php"):
            for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if line.strip().startswith("//"):
                    continue
                rel = path.relative_to(source).as_posix()
                for match in re.finditer(r"\b(mt_rand|rand|random_int|array_rand|openssl_random_pseudo_bytes)\s*\(", line):
                    rng.append({"path": rel, "line": number, "function": match[1]})
                if re.search(r"GetSpinSettings|GetBalance\(\) <=|goto NewSpin|\$bank->(?:slots|bonus) <|\$this->Percent =|SpinWinLimit", line):
                    fairness.append({"path": rel, "line": number})
        result["sample_audits"].append({"game_id": name, "repository": "taxipult/goldsvet",
            "requested_title_absent": "Gonzo's Quest" if name == "JumanjiNET" else None,
            "substitution_reason": "Same-provider adventure-themed title only; not Gonzo mechanics" if name == "JumanjiNET" else None,
            "frontend": {key: "MISSING" for key in ("client_entry_target", "symbols", "backgrounds", "audio", "controls", "paytable_help", "autoplay", "mobile_layout")},
            "presentation": {key: "UNKNOWN_MISSING_CLIENT" for key in ("reel_direction", "reel_stop_order", "symbol_stop_behavior", "win_highlighting", "anticipation", "transitions")},
            "ui_match_likelihood": "UNKNOWN", "backend_reusable_as_is": "WITH FIXES",
            "as_is_acceptable": False, "feature_audit": "See REPORT.md section 5, corresponding numbered sample; no client feature screens present",
            "mandatory_fixes": ["outcome RNG", "remove bank-dependent filtering", "validate global math", "wallet settlement", "auth/session integration", "idempotency", "recovery", "security"],
            "rng_search_locations": rng, "fairness_search_locations": fairness,
            "location_qualification": "Static search hits, not independent proof each branch is reachable; REPORT.md distinguishes live Pragmatic helpers, copied legacy settings and commented code."})
    result["additional_tree_screens"] = []
    for name in ("s0bvi-goldsvet-opensource", "louisbrant-goldsvet-pragmatic"):
        path = external / (name + "-screen-tree.json")
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            result["additional_tree_screens"].append({"cache_id": name, "commit": data["sha"], "tree_truncated": data["truncated"], "file_count": sum(x["type"] == "blob" for x in data["tree"]), "promoted_to_audit": False, "reason": "No larger browser game client pack established from actual tree"})
    return result

if __name__ == "__main__":
    external = pathlib.Path(sys.argv[1]).resolve()
    output = pathlib.Path(sys.argv[2]).resolve()
    result = build(external)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for repo in result["repositories"]:
        print(repo["repository"], repo["counts"], repo["provider_counts_nonexclusive"], "unattributed", repo["provider_unattributed_game_directories"])
