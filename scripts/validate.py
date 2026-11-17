#!/usr/bin/env python3
"""Validate data/taxonomy.json.

Fails when an id is reused, or when one direction lists the same English form twice.
Also fails on cross-direction copies of the same form, and on directions outside 4–7 forms.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "taxonomy.json"


def norm(text):
    return " ".join(str(text).strip().lower().split())


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    errors = []
    seen = {}
    leaves = []

    def claim(kind, value):
        if not isinstance(value, str) or not value.strip():
            errors.append(f"empty {kind} id")
            return
        if value in seen:
            errors.append(f"duplicate id {value} ({seen[value]} and {kind})")
        else:
            seen[value] = kind

    for cat in data["categories"]:
        claim("category", cat.get("id"))
        if not str(cat.get("id", "")).startswith("cat-"):
            errors.append(f"category id {cat.get('id')} is missing the cat- prefix")
        for group in cat["groups"]:
            claim("group", group.get("id"))
            for leaf in group["leaves"]:
                claim("leaf", leaf.get("id"))
                leaves.append(leaf)
                reps = leaf.get("representations") or []
                if not 4 <= len(reps) <= 7:
                    errors.append(f"{leaf.get('id')} has {len(reps)} forms")
                folded = [norm(rep) for rep in reps]
                if len(folded) != len(set(folded)):
                    errors.append(f"duplicate form within {leaf.get('id')}: {reps}")
                if len(leaf.get("name", "")) != 2:
                    errors.append(f"direction name is not two characters: {leaf.get('name')}")

    by_form = {}
    for leaf in leaves:
        for rep in leaf["representations"]:
            by_form.setdefault(norm(rep), []).append(f"{leaf['name']}/{leaf['id']}")
    for form, owners in sorted(by_form.items()):
        if len(owners) > 1:
            errors.append(f"form {form!r} is shared by {owners}")

    intro = data["meta"]["intro"]
    text = intro if isinstance(intro, str) else "".join(intro)
    if text.strip() != "表达 = RU + 语义方向":
        errors.append(f"intro must be the single line, got {text!r}")

    names = []
    for item in data["meta"]["exclusions"]:
        if not isinstance(item, dict) or set(item) != {"name"}:
            errors.append(f"exclusion must be a name only: {item}")
            continue
        names.append(item["name"])
    for required in ("情态算子", "时体算子", "极性算子", "空间与位置", "条件与假设"):
        if required not in names:
            errors.append(f"missing exclusion {required}")

    if errors:
        print("INVALID")
        print("\n".join(errors))
        return 1

    n_cat = len(data["categories"])
    n_group = sum(len(cat["groups"]) for cat in data["categories"])
    n_leaf = len(leaves)
    n_rep = sum(len(leaf["representations"]) for leaf in leaves)
    print(f"ok categories={n_cat} groups={n_group} directions={n_leaf} forms={n_rep}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
