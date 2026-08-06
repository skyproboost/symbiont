import {
  claimNode,
  ensureFeedLog,
  nodeBrief
} from "./session-start-jrfcnane.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  lessonsForZones,
  zoneOf
} from "./session-start-kq7yws6c.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-xsjahv15.js";
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
} from "./session-start-mwmgewqe.js";
import"./session-start-70d7ckvt.js";

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

// src/hooks/user-prompt-core.ts
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
      const fresh = matched.filter((n) => claimNode(db, sid, n.file));
      const lines = fresh.map((n) => `- ${nodeBrief(db, n)}`);
      let relatedBlock = "";
      if (matched.length > 0) {
        const edges = db.query("SELECT from_file, to_file FROM graph_edges").all();
        if (edges.length > 0) {
          const edgeList = edges.map((e) => ({ from: e.from_file, to: e.to_file }));
          const seedFiles = new Set(matched.map((n) => n.file));
          const seeds = matched.map((n) => ({ file: n.file, weight: 50 }));
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
          }
        }
      }
      let lessonBlock = "";
      if (matched.length > 0 && shouldFeed(db, "lesson")) {
        const zones = [...new Set(matched.map((n) => zoneOf(n.file)))];
        const freshZones = zones.filter((z) => claimNode(db, sid, `#lesson:${z}`, "lesson"));
        if (freshZones.length > 0) {
          const lessons = lessonsForZones(db, freshZones, 2);
          if (lessons.length > 0) {
            lessonBlock = `Symbiont · ${t("уроки по зоне (из прошлых поправок владельца — не повтори)", "lessons for this area (from the owner's past corrections — do not repeat them)")}: ${lessons.map((l) => statement(l.statement)).join(" · ")}`;
          }
        }
      }
      if (fresh.length === 0 && !relatedBlock && !lessonBlock && !tableBlock)
        return {};
      const DEEP_THRESHOLD = 30;
      const deep = fresh.filter((n) => n.in_deg >= DEEP_THRESHOLD);
      const depthNote = deep.length > 0 ? t(`
Узлы глубокого влияния (${deep.map((n) => `${n.file}: вход ${n.in_deg}`).join("; ")}) — правки таких узлов многофайловые по последствиям.`, `
Deep-influence nodes (${deep.map((n) => `${n.file}: in ${n.in_deg}`).join("; ")}) — changes to these have multi-file consequences.`) : "";
      const graphBlock = lines.length > 0 ? `Symbiont · ${t("срез графа по упомянутым файлам (полный радиус: passport_impact)", "graph slice for the files you mentioned (full radius: passport_impact)")}:
${lines.join(`
`)}${depthNote}` : "";
      return {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: [tableBlock, graphBlock, relatedBlock, lessonBlock].filter(Boolean).join(`

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
