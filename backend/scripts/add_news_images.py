import json
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "news.json"
data = json.loads(p.read_text(encoding="utf-8"))
count = 0
for _sym, items in data.items():
    for i, item in enumerate(items):
        if item.get("importance") in ("high", "medium") or i < 3:
            item["imageUrl"] = f"https://picsum.photos/seed/{item['id']}/640/360"
            count += 1
        else:
            item.setdefault("imageUrl", None)
p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"updated imageUrl on {count} items")
