#!/usr/bin/env python3
"""Generate viewer-data.js — a self-contained manifest of the ui-breakdown tree
so viewer.html can render it over file:// with no server/fetch."""
import json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the ui-breakdown dir
CAP = 90000  # per-file char cap so the manifest stays a sane size


def read(p):
    try:
        s = open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        return None
    if len(s) > CAP:
        s = s[:CAP] + "\n\n… [truncated for viewer — open the file on disk for the rest] …"
    return s


def pascal(folder):
    return "".join(w[:1].upper() + w[1:] for w in folder.split("-"))


def first(globpat, prefer=None):
    files = sorted(glob.glob(globpat))
    if not files:
        return None
    if prefer:
        for f in files:
            if os.path.basename(f).lower().startswith(prefer.lower()):
                return f
    return files[0]


def comp_node(cdir):
    name = os.path.basename(cdir)
    spec = read(os.path.join(cdir, name + ".md"))
    fixture = read(os.path.join(cdir, "isolate", "fixture.json"))
    cases = []
    for cj in sorted(glob.glob(os.path.join(cdir, "isolate", "cases", "*", "*.json"))):
        cases.append({"name": os.path.basename(cj), "content": read(cj)})
    cssf = first(os.path.join(cdir, "css", "*"))
    srcf = first(os.path.join(cdir, "js", "*"), prefer=pascal(name))
    checklist = read(os.path.join(cdir, "screenshots", "capture-checklist.md"))
    return {
        "name": name,
        "component": pascal(name),
        "spec": spec,
        "fixture": fixture,
        "cases": cases,
        "css": read(cssf) if cssf else None,
        "cssName": os.path.basename(cssf) if cssf else None,
        "source": read(srcf) if srcf else None,
        "sourceName": os.path.basename(srcf) if srcf else None,
        "checklist": checklist,
    }


def has_isolate(d):
    return os.path.isdir(os.path.join(d, "isolate"))


overview = []
for f in ["index.md", "design-tokens.md", "data-model.md"]:
    md = read(os.path.join(ROOT, f))
    if md is not None:
        overview.append({"title": f, "md": md})

shared = [comp_node(d) for d in sorted(glob.glob(os.path.join(ROOT, "shared-components", "*")))
          if os.path.isdir(d) and has_isolate(d)]

pages = []
for p in sorted(glob.glob(os.path.join(ROOT, "pages", "*"))):
    if not os.path.isdir(p):
        continue
    pn = os.path.basename(p)
    pageMd = read(os.path.join(p, pn + ".md"))
    comps = [comp_node(d) for d in sorted(glob.glob(os.path.join(p, "components", "*")))
             if os.path.isdir(d) and has_isolate(d)]
    pages.append({"name": pn, "pageMd": pageMd, "components": comps})

data = {
    "overview": overview,
    "shared": shared,
    "pages": pages,
    "stats": {
        "pages": len(pages),
        "shared": len(shared),
        "components": len(shared) + sum(len(p["components"]) for p in pages),
        "cases": sum(len(c["cases"]) for c in shared) + sum(len(c["cases"]) for p in pages for c in p["components"]),
    },
}

out = os.path.join(ROOT, "viewer-data.js")
with open(out, "w", encoding="utf-8") as fh:
    fh.write("window.UIB = ")
    json.dump(data, fh, ensure_ascii=False)
    fh.write(";\n")

size = os.path.getsize(out)
print(f"wrote {out}  ({size/1024:.0f} KB)")
print("stats:", json.dumps(data["stats"]))
