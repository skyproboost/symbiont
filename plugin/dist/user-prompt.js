import {
  claimNode,
  ensureFeedLog,
  nodeBrief
} from "./session-start-f416vzn2.js";
import {
  lessonsForZones,
  zoneOf
} from "./session-start-6c4w21x4.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-9rqh6363.js";
import {
  FactStore,
  beat,
  effectiveHeat,
  hotFiles,
  initLang,
  init_i18n,
  observePrompt,
  openDb,
  reachableUndirected,
  readHeatRows,
  shouldFeed,
  slugOf,
  statement,
  t,
  taskRelevantNeighbors
} from "./session-start-0svyw48g.js";
import"./session-start-rvra3cez.js";

// src/hooks/user-prompt.ts
import { join as join2 } from "node:path";

// src/hooks/user-prompt-core.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
init_i18n();

// src/passport/roles.ts
var ROLE_CATALOG = {
  корректность: {
    lens: "что здесь может тихо сломаться",
    checks: ["какой существующий тест это докажет", "какие вызывающие места затронуты (вход узла)", "есть ли путь ошибки без обработки"],
    search: "тесты рядом с затронутым кодом + passport_impact по файлу"
  },
  производительность: {
    lens: "цена на горячем пути",
    checks: ["что аллоцируется/читается в цикле", "растёт ли размер бандла/запроса", "есть ли лишний проход по данным"],
    search: "passport_map ключевых модулей, замеры из README/скриптов"
  },
  SEO: {
    lens: "что увидит краулер",
    checks: ["мета/OG/каноникал целы", "перелинковка не порвана", "скорость страницы не просела"],
    search: "sitemap/robots/meta-слои проекта"
  },
  "целостность данных": {
    lens: "что станет с уже существующими данными",
    checks: ["миграция обратима", "старые строки переживут новую схему", "есть ли транзакционная граница"],
    search: "каталог миграций + passport_history по схеме"
  },
  безопасность: {
    lens: "какой вход остался без проверки и что ослабили",
    checks: ["валидация на границе не обойдена", "защитный слой не снят и не расширен CORS/права", "секреты не утекли в код/логи"],
    search: "найденные защитные слои из профиля + диффы затронутых границ"
  },
  приватность: {
    lens: "куда текут персональные данные",
    checks: ["не попали ли перс. данные в логи/аналитику", "передача наружу — только необходимое", "хранение — не дольше нужного"],
    search: "точки логирования и внешних вызовов в затронутой зоне"
  },
  наблюдаемость: {
    lens: "как это увидим в проде",
    checks: ["ошибка оставит след с контекстом", "метрика/лог не потеряли смысл после правки"],
    search: "существующие точки логирования зоны"
  },
  доступность: {
    lens: "работает ли это без мыши и с ридером",
    checks: ["фокус и aria-атрибуты целы", "контраст/размеры не ухудшены"],
    search: "канон компонентов зоны"
  },
  совместимость: {
    lens: "переживёт ли это слабое устройство и старый браузер",
    checks: ["нет ли API за пределами матрицы платформ", "деградация мягкая, не белый экран"],
    search: "browserslist/матрица платформ из паспорта"
  },
  поставляемость: {
    lens: "доедет ли это до прода без рук",
    checks: ["CI-шаги не сломаны", "конфиг/env согласованы между средами"],
    search: "CI-конфиги и Dockerfile"
  }
};
var GENERIC = {
  lens: "что по этой оси может регресснуть от правки",
  checks: ["какие сигналы оси затронуты", "чем докажем, что не стало хуже"],
  search: "passport_conventions по области"
};
function rolesFromProfile(profileFacts) {
  const roles = [];
  for (const f of profileFacts) {
    const axis = f.statement.split("—")[0].trim();
    const base = ROLE_CATALOG[axis] ?? GENERIC;
    roles.push({ axis, ...base });
  }
  return roles;
}
var HIGH_STAKES = /(миграци|схем[ау] (бд|данных)|drop|truncate|delete from|депло[йя]|релиз|в прод|production|секрет|токен|пароль|api-?ключ|оплат|платеж|платёж|биллинг|деньг|безопасн|уязвим|cors|csp|права доступа|удали (весь|все|базу)|rm -rf)/i;
function isHighStakes(prompt) {
  return HIGH_STAKES.test(prompt);
}
function renderTable(roles, maxRoles = 4) {
  const picked = roles.slice(0, maxRoles);
  const lines = [
    "Symbiont · стол проекта (задача выглядит high-stakes). Роли ниже — линзы для внутреннего спора в размышлении; наружу — решение и главные риски, не сам спор:"
  ];
  for (const r of picked) {
    lines.push(`- ${r.axis}: ${r.lens}. Проверить: ${r.checks.join("; ")}. Где искать: ${r.search}.`);
  }
  return lines.join(`
`);
}

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

// src/hooks/user-prompt-core.ts
import { statSync } from "node:fs";
var MAX_NODES = 3;
var MIN_TOKEN_LEN = 4;
function promptTokens(prompt) {
  const tokens = prompt.toLowerCase().match(/[\w$][\w$.\-/]*[\w$]/g) ?? [];
  return [...new Set(tokens.filter((t2) => t2.length >= MIN_TOKEN_LEN))];
}
var base = (file) => {
  const b = file.slice(file.lastIndexOf("/") + 1).toLowerCase();
  return b;
};
var baseNoExt = (file) => base(file).replace(/\.[a-z]+$/, "");
var SYMBOL_SEED_WEIGHT = 10;
var SYMBOL_FILES_MAX = 2;
var SYMBOL_SEEDS_MAX = 4;
var SYMBOL_TOKENS_MAX = 40;
var DELEGATE_MIN_COMMUNITIES = 3;
var DELEGATE_MIN_TOKENS = 25000;
function symbolSeedFiles(db, tokens, exclude) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='symbols'").get().n > 0;
    if (!has || tokens.length === 0)
      return [];
    const capped = tokens.slice(0, SYMBOL_TOKENS_MAX);
    const rows = db.query(`SELECT DISTINCT lower(name) AS lname, file FROM symbols WHERE lower(name) IN (${capped.map(() => "?").join(",")})`).all(...capped);
    const byName = new Map;
    for (const r of rows) {
      const list = byName.get(r.lname) ?? [];
      list.push(r.file);
      byName.set(r.lname, list);
    }
    const out = [];
    for (const files of byName.values()) {
      if (files.length > SYMBOL_FILES_MAX)
        continue;
      for (const f of files) {
        if (exclude.has(f) || out.includes(f))
          continue;
        out.push(f);
        if (out.length >= SYMBOL_SEEDS_MAX)
          return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
function handleUserPrompt(input, dataRoot) {
  try {
    const prompt = input.prompt ?? "";
    const cwd = input.cwd ?? process.cwd();
    if (prompt.length < MIN_TOKEN_LEN)
      return {};
    const dataDir = join(dataRoot, slugOf(cwd));
    beat(dataDir, "UserPromptSubmit");
    observePrompt(dataDir, prompt);
    initLang(dataDir, cwd);
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const db = openDb(dbPath);
    try {
      ensureFeedLog(db);
      const sid = input.session_id ?? "manual";
      let tableBlock = "";
      if (isHighStakes(prompt) && shouldFeed(db, "table") && claimNode(db, sid, "#стол", "table")) {
        try {
          const profile = new FactStore(db).active().filter((f) => f.area === "профиль качества");
          const roles = rolesFromProfile(profile);
          if (roles.length > 0)
            tableBlock = renderTable(roles);
        } catch {}
      }
      const nodes = db.query("SELECT file, in_deg, out_deg FROM graph_nodes").all();
      const tokens = promptTokens(prompt);
      const tokenSet = new Set(tokens);
      const matched = nodes.filter((n) => tokenSet.has(base(n.file)) || tokenSet.has(baseNoExt(n.file))).sort((a, b) => b.in_deg - a.in_deg).slice(0, MAX_NODES);
      const seedFiles = new Set(matched.map((n) => n.file));
      const symFiles = symbolSeedFiles(db, tokens, seedFiles);
      const symNodes = symFiles.map((f) => nodes.find((n) => n.file === f)).filter((n) => n !== undefined);
      const fresh = [...matched, ...symNodes].filter((n) => claimNode(db, sid, n.file));
      const lines = fresh.map((n) => `- ${nodeBrief(db, n)}`);
      let relatedBlock = "";
      let delegateBlock = "";
      if (matched.length > 0 || symFiles.length > 0) {
        const edges = db.query("SELECT from_file, to_file FROM graph_edges").all();
        if (edges.length > 0) {
          const edgeList = edges.map((e) => ({ from: e.from_file, to: e.to_file }));
          const seeds = matched.map((n) => ({ file: n.file, weight: 50 }));
          for (const sf of symFiles) {
            seedFiles.add(sf);
            seeds.push({ file: sf, weight: SYMBOL_SEED_WEIGHT });
          }
          const heat = effectiveHeat(readHeatRows(db), Date.now());
          for (const hf of hotFiles(heat, 0.5, 5)) {
            if (!seedFiles.has(hf)) {
              seedFiles.add(hf);
              seeds.push({ file: hf, weight: 10 });
            }
          }
          const neighborhood = reachableUndirected(edgeList, seedFiles, 2);
          if (neighborhood.size > 0) {
            const allNodes = nodes.map((n) => n.file);
            const ranked = taskRelevantNeighbors(allNodes, edgeList, seeds, neighborhood, 8);
            const related = [];
            for (const cand of ranked) {
              if (related.length >= 3)
                break;
              if (claimNode(db, sid, cand.file, "related"))
                related.push(cand.file);
            }
            if (related.length > 0) {
              relatedBlock = `Symbiont · ${t("связано с задачей (по связям проекта, а не по совпадению слов)", "related to the task (by the project's links, not by word overlap)")}: ${related.join(", ")}`;
            }
            try {
              if (shouldFeed(db, "delegate")) {
                const zone = [...new Set([...seedFiles, ...neighborhood])];
                const view = delegationView(zone, communityLabels(allNodes, edgeList), (f) => statSync(join(cwd, f)).size);
                if (view.communities >= DELEGATE_MIN_COMMUNITIES && view.approxTokens >= DELEGATE_MIN_TOKENS && claimNode(db, sid, "#delegate", "delegate")) {
                  const named = view.names.slice(0, 4).join(", ");
                  delegateBlock = `Symbiont · ${t(`охват задачи по графу: ${view.communities} подсистем (${named}), чтение окружения целиком ≈${Math.round(view.approxTokens / 1000)}k токенов — разведку по подсистемам дешевле делегировать сабагентам и свести выводы, чем вносить всё в одно окно`, `task footprint by the graph: ${view.communities} subsystems (${named}), reading the full neighborhood ≈${Math.round(view.approxTokens / 1000)}k tokens — delegating per-subsystem exploration to subagents and merging conclusions is cheaper than pulling it all into one window`)}`;
                }
              }
            } catch {}
          }
        }
      }
      let lessonBlock = "";
      const lessonAnchors = [...matched.map((n) => n.file), ...symFiles];
      if (lessonAnchors.length > 0 && shouldFeed(db, "lesson")) {
        const zones = [...new Set(lessonAnchors.map((f) => zoneOf(f)))];
        const freshZones = zones.filter((z) => claimNode(db, sid, `#lesson:${z}`, "lesson"));
        if (freshZones.length > 0) {
          const lessons = lessonsForZones(db, freshZones, 2);
          if (lessons.length > 0) {
            lessonBlock = `Symbiont · ${t("уроки по зоне (из прошлых поправок владельца — не повтори)", "lessons for this area (from the owner's past corrections — do not repeat them)")}: ${lessons.map((l) => statement(l.statement)).join(" · ")}`;
          }
        }
      }
      if (fresh.length === 0 && !relatedBlock && !delegateBlock && !lessonBlock && !tableBlock)
        return {};
      const DEEP_THRESHOLD = 30;
      const deep = fresh.filter((n) => n.in_deg >= DEEP_THRESHOLD);
      const depthNote = deep.length > 0 ? t(`
Узлы глубокого влияния (${deep.map((n) => `${n.file}: вход ${n.in_deg}`).join("; ")}) — правки таких узлов многофайловые по последствиям.`, `
Deep-influence nodes (${deep.map((n) => `${n.file}: in ${n.in_deg}`).join("; ")}) — changes to these have multi-file consequences.`) : "";
      const graphBlock = lines.length > 0 ? `Symbiont · ${t("срез графа по упомянутому в промпте — файлам и символам (полный радиус: passport_impact)", "graph slice for the files and symbols you mentioned (full radius: passport_impact)")}:
${lines.join(`
`)}${depthNote}` : "";
      return {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: [tableBlock, graphBlock, relatedBlock, delegateBlock, lessonBlock].filter(Boolean).join(`

`)
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/user-prompt.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root;
var out = handleUserPrompt(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
