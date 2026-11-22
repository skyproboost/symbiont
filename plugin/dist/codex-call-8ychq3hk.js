// src/domains/playbooks.ts
var PLAYBOOKS = [
  {
    domain: "база данных",
    triggers: ["база данных", "postgres", "mysql", "mongodb"],
    checklist: [
      "нормализация до 3NF; денормализация только под доказанный путь чтения (materialized view / колонка через триггер)",
      "индексы по форме запроса: B-tree (=,<,>,ORDER BY,prefix); GIN (JSONB/массивы/FTS); BRIN (большие упорядоченные); partial/expression/covering (INCLUDE) для index-only",
      "целостность в БД, не в приложении: PK/FK/NOT NULL/UNIQUE/CHECK, типы (timestamptz, numeric для денег)",
      "zero-downtime миграции = expand/contract: новая колонка → dual-write → backfill батчами ≤100K → переключить чтение → drop старой последней",
      "lock-дисциплина DDL: SET lock_timeout ~5s первым стейтментом; CREATE INDEX CONCURRENTLY; NOT NULL через CHECK NOT VALID + VALIDATE",
      "пул соединений обязателен: PgBouncer в transaction mode; не поднимать max_connections в тысячи",
      "бэкапы + PITR: непрерывный WAL-архив + base backup; pg_dump — НЕ PITR; нетестированный restore — не бэкап (тест по расписанию)",
      "autovacuum на горячих/больших таблицах — per-table (scale_factor низкий/0 + threshold), не дефолт",
      "триггеры экономно: аудит и производная колонка — да; бизнес-логика/сетевой IO в триггере — нет",
      "партиционирование больших таблиц декларативно (range/list) с естественным ключом (обычно время)"
    ],
    thresholds: ["backfill батчи ≤100K строк", "lock_timeout ~5s на DDL", "max_connections — низкие сотни + пул"],
    pitfalls: [
      "plain CREATE INDEX / ADD NOT NULL в проде → ACCESS EXCLUSIVE лок → простой",
      "max_connections=1000 без пула → исчерпание памяти до первого запроса",
      "pg_dump как DR без PITR; бэкапы без тест-restore",
      "дефолтный autovacuum на огромной таблице → раздувание → аварийный VACUUM FULL с эксклюзивным локом"
    ],
    source: "PostgreSQL docs (indexes / continuous-archiving / routine-vacuuming / ddl-partitioning), PgBouncer docs"
  },
  {
    domain: "веб-сервер",
    triggers: ["веб-сервер", "nginx"],
    checklist: [
      "TLS Mozilla Intermediate (TLS1.2+1.3, ECDHE+AEAD, prefer_server_ciphers off) или Modern (TLS1.3 only); ECDSA-сертификаты; цель SSL Labs A+",
      "HSTS: Strict-Transport-Security max-age=63072000; includeSubDomains; preload — с always",
      "HTTP/2 + HTTP/3 (QUIC, listen 443 quic reuseport, Alt-Svc h3); HTTP/3 требует TLS1.3",
      "Brotli для статики + gzip fallback, только text-типы; pre-compress .br/.gz; всегда Vary: Accept-Encoding; не жать картинки/видео",
      "кэш статики: fingerprint-ассеты Cache-Control public,max-age=31536000,immutable; HTML — no-cache/короткий",
      "rate-limit (limit_req zone + burst nodelay, limit_conn); за CDN — обязательно real_ip (set_real_ip_from)",
      "security-заголовки: CSP (несущий), X-Content-Type-Options nosniff, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy",
      "per-location тюнинг: статика (агресс. кэш) vs API (rate-limit/буферы/таймауты) vs upload (client_max_body_size)"
    ],
    thresholds: ["HSTS max-age ≥ 63072000 (2 года)", "immutable-ассеты max-age=31536000", "SSL Labs A+"],
    pitfalls: [
      "копипаст старых cipher-листов (TLS1.0/1.1, RC4) → SSL Labs C/F",
      "длинный кэш HTML → пользователи застряли на старой версии",
      "gzip на картинках/PDF или без Vary → CDN отдаёт сжатое неспособным клиентам",
      "rate-limit за CDN без real_ip → троттлинг всего сайта как один IP"
    ],
    source: "nginx.org docs, Mozilla SSL Config, MDN Cache-Control, web.dev"
  },
  {
    domain: "node-бэкенд",
    triggers: ["express", "fastify", "nestjs", "nitro"],
    checklist: [
      "никогда не блокировать event loop: без *Sync в хендлерах (fs/crypto/zlib/execSync)",
      "ограничивать дорогой вход: размеры тела/JSON, стримить большие payload; без ReDoS-регулярок",
      "cluster (процессы, изоляция) для I/O-масштабирования vs worker_threads для CPU (image/crypto/ML); воркеров ≈ availableParallelism()",
      "ограниченный пул воркеров, не поток-на-запрос; задачи сопоставимой стоимости",
      "backpressure всегда: writable.write()===false → ждать drain; stream.pipeline() вместо .pipe()",
      "контракт ошибок: unhandledRejection/uncaughtException — логгер+graceful shutdown+exit(1), не «resume»",
      "graceful shutdown на SIGTERM: перестать принимать → дренаж in-flight → закрыть пулы → exit",
      "память: чинить утечки, не поднимать --max-old-space-size вслепую; heap-снэпшоты в низкий трафик; heap под лимит контейнера (Node 20+)",
      "лимиты соединений/пулов (align с БД/PgBouncer), таймауты запросов, лимит тела (анти-slowloris)",
      "наблюдаемость петли: event-loop lag/utilization как главный сигнал насыщения"
    ],
    thresholds: ["задача в петле < 50мс (long task)", "воркеров ≈ os.availableParallelism()"],
    pitfalls: [
      "sync crypto/zlib/fs в хендлере → один запрос стопорит всех",
      "catch-all uncaughtException с «continue» → повреждённое состояние, тихая потеря данных",
      "нет SIGTERM-хендлера → in-flight запросы теряются на каждом деплое",
      ".pipe() без обработки ошибок → утечки FD/сокетов; игнор write()===false → OOM"
    ],
    source: "nodejs.org (Dont Block the Event Loop / Backpressuring / cluster / worker_threads / process)"
  },
  {
    domain: "фронтенд",
    triggers: ["фронтенд", "nuxt", "next.js", "react", "vue", "svelte", "angular"],
    checklist: [
      "Core Web Vitals на p75 (поле, не лаб): LCP≤2.5с, INP≤200мс, CLS≤0.1 — все три",
      "LCP: preload/priority LCP-картинки, в исходном HTML, не через JS; бить load-delay",
      "INP: задачи main-thread <50мс, yield к потоку, defer некритичного JS",
      "code-splitting по маршрутам (import()), lazy ниже-сгиба и сторонние скрипты после LCP; budget в CI",
      "кроссбраузер через browserslist (единый конфиг → Babel/PostCSS/бандлер); прогресс-энхансмент, не UA-sniffing",
      "a11y WCAG 2.2 AA: цель ≥24×24px, видимый фокус, контраст 4.5:1/3:1, клавиатура, prefers-reduced-motion",
      "offline/сеть: service worker (cache-first статика, network-first данные+fallback), retry с backoff, SSR/стриминг",
      "слабое устройство: throttle CPU 4-6×, медленная сеть; лёгкая гидрация (islands/partial/RSC)",
      "утечки SPA: снимать listeners/observers/timers на unmount, AbortController для fetch; проверка heap-снэпшотами",
      "стабильность layout: резервировать размеры картинок/эмбедов (aspect-ratio), font-display аккуратно"
    ],
    thresholds: ["LCP≤2.5с · INP≤200мс · CLS≤0.1 (p75)", "long task <50мс", "цель нажатия ≥24×24 CSS px", "контраст ≥4.5:1"],
    pitfalls: [
      "оптимизация лаб-Lighthouse при провале поля p75 (Google смотрит поле)",
      "LCP-картинка обнаруживается JS после гидрации → огромный load-delay",
      "монолитный бандл/жадная гидрация → высокий INP на слабых телефонах",
      "картинки/ads без размеров → всплески CLS; SPA без очистки подписок → рост памяти → краш вкладки"
    ],
    source: "web.dev Web Vitals / Optimize LCP / INP, MDN, W3C WCAG 2.2"
  },
  {
    domain: "SEO",
    triggers: ["SEO"],
    checklist: [
      "E-E-A-T (доверие — главное): опыт из первых рук, экспертиза, авторитет; тест «Кто/Как/Зачем» (авторство, методология, польза людям)",
      "технический фундамент: краулимость, индексируемость, структурные данные (schema.org), Core Web Vitals как предпосылка",
      "мета/OG/canonical/hreflang на локаль целы",
      "перелинковка: достижимость из хабов, без сирот, без дублей анкоров, транзитивная сеть",
      "people-first контент: оригинальный, исчерпывающий, добавляет ценность (helpful content — непрерывный классификатор в ядре ранжирования)"
    ],
    pitfalls: [
      "контент под ранжирование, а не под людей → helpful-content классификатор топит",
      "полный текст в RSS/дублирование → каннибализация/скрейпинг",
      "битая перелинковка/сироты → страницы недостижимы краулером"
    ],
    source: "Google Search — Creating Helpful Content / E-E-A-T; web.dev"
  },
  {
    domain: "деплой/оркестрация",
    triggers: ["деплой/инфра", "оркестрация/масштабирование", "docker", "kubernetes", "helm", "terraform", "pm2", "systemd", "serverless/lambda", "ci"],
    checklist: [
      "zero-downtime: rolling (дефолт) / canary (при метриках SLO, 5→20→50→100% + авто-rollback) / blue-green (stateful, мгновенный откат)",
      "readiness проверяет зависимости (БД/кэш достижимы), liveness — лёгкий и ОТДЕЛЬНЫЙ (не дёргать зависимости); startup для медленного старта",
      "graceful SIGTERM: перестать принимать → дренаж in-flight → выход; preStop sleep 5–10с (LB реконсилит медленно); terminationGracePeriodSeconds ≥ preStop+макс. запрос",
      "Docker: multi-stage, distroless/nonroot, USER не-root, base по digest (@sha256) + еженедельный пересбор CI, .dockerignore, HEALTHCHECK бинарём (не curl), лимиты памяти/CPU",
      "k8s: requests И limits каждому контейнеру (ratio ≤4:1), PodDisruptionBudget для HA, maxUnavailable:0 maxSurge:1, progressDeadlineSeconds, secrets вне образа",
      "автоскейл: HPA цель ~70% (min/max + scaleDown stabilization 300с); VPA только recommend в проде; НИКОГДА VPA+HPA по одной метрике",
      "масштаб: statelessness — предпосылка scale-out (state в Redis/внешнее); БД — типичное узкое место (реплики чтения/пул/кэш до масштабирования тиров)",
      "pm2: cluster mode + reload (не restart) + max_memory_restart; systemd: Restart= + MemoryMax + MemoryAccounting=true + non-root User=, drop-in (не править vendor-юнит)",
      "IaC (Terraform/SAM): всё в коде, версии провайдеров пиннить, remote state с локом, plan-review в CI, без правок через консоль (дрейф)",
      "serverless: холодный старт (ARM/SnapStart до Provisioned Concurrency), reserved concurrency для защиты БД от шторма, INIT billed — держать лёгким"
    ],
    thresholds: ["requests:limits ≤ 4:1", "HPA ~70% CPU · scaleDown 300с", "preStop 5–10с · grace ≥30с", "rolling maxUnavailable:0/maxSurge:1"],
    pitfalls: [
      "502 на каждом деплое → нет preStop sleep (LB ещё роутит на закрытый сокет)",
      "liveness на общую зависимость → шторм рестартов; нет readiness → трафик на неготовые поды",
      "VPA+HPA по CPU вместе → осцилляция; нет requests → переупаковка ноды → OOM/evict",
      "масштабируют тир приложения при узком месте в БД → реплики добивают БД (исчерпание пула)",
      "pm2 restart вместо reload → дроп запросов; нет max_memory_restart → утечка кладёт хост",
      "FROM node:latest → невоспроизводимо; root-контейнер → эскалация на хост"
    ],
    source: "kubernetes.io (probes/HPA/rollbacks), docs.docker.com, pm2/systemd docs, 12factor.net, AWS Well-Architected"
  },
  {
    domain: "TLS/сертификаты",
    triggers: ["веб-сервер", "nginx", "деплой/инфра"],
    checklist: [
      "полностью автоматический ACME (certbot/acme.sh/lego/caddy); staging до прода",
      "ранний и частый renew: срок LE идёт к 45 дням — хардкод «renew на 60д» сломается; таймер ≥2×/сутки",
      "ARI (RFC 9773): клиент опрашивает renewalInfo и чтит suggestedWindow (certbot ≥4.1)",
      "OCSP у LE отменён (с 2025 — CRL, без OCSP AIA); не полагаться на OCSP-stapling; короткие сроки = стратегия отзыва",
      "защита ACME-account-key и приватных ключей; ротация ключа при renew; CT-мониторинг (crt.sh) на mis-issuance",
      "wildcard (DNS-01, риск в одном ключе) vs multi-SAN (гранулярнее); метод валидации под случай (HTTP-01/DNS-01/TLS-ALPN-01)",
      "внешний мониторинг истечения независимо от renewer (алерт за ~14 дней)"
    ],
    thresholds: ["renew на ~1/3 остатка срока", "алерт истечения ≥14 дней", "таймер renew ≥2×/сутки"],
    pitfalls: [
      "ручной/разовый сертификат → забытое истечение → жёсткий простой",
      "каденс под 90-дневные при переходе на 45 → истечение в середине окна",
      "опора на OCSP-stapling для LE после 2025 (его нет)",
      "ручные DNS-01 TXT → renew «работает раз», потом падает молча"
    ],
    source: "Let's Encrypt (45-day / ARI / integration-guide), RFC 9773"
  }
];
function playbooksFor(signals) {
  const active = new Set([...signals.frameworks, ...signals.infra, ...signals.domains]);
  return PLAYBOOKS.filter((p) => p.triggers.some((t) => active.has(t)));
}
function renderPlaybookBrief(p) {
  const lines = [`Symbiont · плейбук «${p.domain}» (топ-уровень здесь):`];
  for (const c of p.checklist.slice(0, 6))
    lines.push(`- ${c}`);
  if (p.thresholds && p.thresholds.length > 0)
    lines.push(`пороги: ${p.thresholds.join(" · ")}`);
  lines.push(`источник: ${p.source}`);
  return lines.join(`
`);
}

export { PLAYBOOKS, playbooksFor, renderPlaybookBrief };
