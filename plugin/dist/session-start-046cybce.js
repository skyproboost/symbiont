// src/graph/communities.ts
var MAX_ROUNDS = 8;
function communityLabels(nodes, edges) {
  const sorted = [...nodes].sort();
  const dirOf = (f) => f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
  const label = new Map(sorted.map((n) => [n, dirOf(n)]));
  const adj = new Map;
  const link = (a, b) => {
    const list = adj.get(a);
    if (list)
      list.push(b);
    else
      adj.set(a, [b]);
  };
  for (const e of edges) {
    if (e.from === e.to)
      continue;
    if (!label.has(e.from) || !label.has(e.to))
      continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }
  for (let round = 0;round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const node of sorted) {
      const neighbors = adj.get(node) ?? [];
      if (neighbors.length === 0)
        continue;
      const counts = new Map;
      for (const nb of neighbors) {
        const l = label.get(nb);
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      const current = label.get(node);
      let best = current;
      let bestN = counts.get(current) ?? 0;
      for (const [l, n] of counts) {
        if (n > bestN || n === bestN && l !== current && best !== current && l < best) {
          best = l;
          bestN = n;
        }
      }
      if (best !== current) {
        label.set(node, best);
        changed = true;
      }
    }
    if (!changed)
      break;
  }
  return label;
}
function communityName(files) {
  const counts = new Map;
  for (const f of files) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best = ".";
  let bestN = 0;
  for (const [dir, n] of counts) {
    if (n > bestN || n === bestN && dir < best) {
      best = dir;
      bestN = n;
    }
  }
  return best;
}
function delegationView(zoneFiles, labels, sizeOf) {
  const byLabel = new Map;
  let chars = 0;
  for (const f of zoneFiles) {
    const l = labels.get(f);
    if (l === undefined)
      continue;
    const list = byLabel.get(l) ?? [];
    list.push(f);
    byLabel.set(l, list);
    try {
      chars += sizeOf(f);
    } catch {}
  }
  const covered = [...byLabel.values()].filter((files) => files.length >= 2);
  covered.sort((a, b) => b.length - a.length || (communityName(a) < communityName(b) ? -1 : 1));
  return {
    communities: covered.length,
    names: covered.map((files) => communityName(files)),
    approxTokens: Math.round(chars / 4)
  };
}

export { communityLabels, communityName, delegationView };
