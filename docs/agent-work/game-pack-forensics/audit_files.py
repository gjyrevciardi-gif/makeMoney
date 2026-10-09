"""Read-only public-repository evidence acquisition; never imports/executes casino code.

External source stays in --external. Git tree enumeration does not require checkout
or blob sizes (the clones can be partial). Raw files are pinned to tree commit IDs.
"""
import argparse
import concurrent.futures
import json
import pathlib
import subprocess
import urllib.parse
import urllib.request

REPOS = {
    "taxipult-goldsvet": "taxipult/goldsvet",
    "promex-opensource-casino-8.5": "promexdotme/opensource-casino-8.5",
    "zeusbyte-goldsvet": "zeusbyte/goldsvet",
}

def tree(root):
    rows = subprocess.check_output(["git", "ls-tree", "-r", "HEAD"], cwd=root, text=True).splitlines()
    return {row.split("\t", 1)[1]: dict(zip(("mode", "type", "oid"), row.split("\t", 1)[0].split())) for row in rows}

def fetch(external, local_name, paths):
    root = external / local_name
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    known = tree(root)
    def one(path):
        if path not in known:
            return {"path": path, "status": "absent_from_tree"}
        destination = external / "evidence" / local_name / pathlib.PurePosixPath(path)
        if destination.exists():
            return {"path": path, "status": "cached", "bytes": destination.stat().st_size}
        url = "https://raw.githubusercontent.com/" + REPOS[local_name] + "/" + sha + "/" + urllib.parse.quote(path)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "static-source-audit"}), timeout=45) as response:
                data = response.read()
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            return {"path": path, "status": "fetched", "bytes": len(data)}
        except Exception as error:
            return {"path": path, "status": "error", "error": str(error)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        return list(pool.map(one, sorted(set(paths))))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external", type=pathlib.Path, required=True)
    parser.add_argument("--repo", choices=REPOS, required=True)
    parser.add_argument("--paths-json", type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(fetch(args.external, args.repo, json.loads(args.paths_json.read_text(encoding="utf-8"))), indent=2))
