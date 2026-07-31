<script setup>
const features = [
  { icon: '🔍', title: 'Мгновенно ориентируется', text: 'При первом заходе строит паспорт проекта и с тех пор знает его как старожил — без переоткрытия каждую сессию.' },
  { icon: '🌍', title: 'Работает с чем угодно', text: 'Не только веб и не только код: JS, Python, Go, PHP, Ruby, Rust, Java — и контент, дизайн, документы, данные. Язык и направление не зашиты, они обнаруживаются.' },
  { icon: '🎯', title: 'Знает, что значит «топ-1» здесь', text: 'Профиль качества выводится из самого продукта — и по зонам: оси наследуются по дереву как CSS по DOM, legacy-модуль получает «менять минимально» там, где корень требует скорости.' },
  { icon: '🔒', title: 'Держит планку детерминированно', text: 'Отклонения ловятся гейтом на лету. Ни одна правка не ослабит защиту молча. Расфокус — работа расползлась, из диффа исчезли проверки — виден без единого токена.' },
  { icon: '🤖', title: 'Работает сам', text: 'Фоновый садовник по триггерам углубляет паспорт, разбирает ваши правки, считает дрейф и hotspot-зоны, чинит порчу. Результат приходит строкой в сводке, а не по запросу.' },
  { icon: '🧭', title: 'Не врёт', text: 'Карта, ведущая в удалённый файл, хуже молчания: паспорт постоянно сверяется с реальностью и вычищает то, чего уже нет.' },
  { icon: '📉', title: 'Учится на себе', text: 'Каждый вид подаваемого знания копит статистику «подано → реально пригодилось». Что на вашем проекте не окупается — система приглушает сама и периодически перепроверяет.' },
  { icon: '🩺', title: 'Никогда не падает молча', text: 'Слоистая деградация, самодиагностика каналов, crash-only. Сломался канал — честное предупреждение, а не тишина.' },
]

const commands = [
  {
    cmd: '/symbiont:status',
    text: 'Что система уже знает о проекте и что делает без вас — сколько правил выведено и сколько дозрело до законов, размер карты связей, что поймал гейт, чем занималась фоновая работа, какие подсказки здесь окупаются. Ничего не пересчитывает, только показывает. Аргументом можно передать каталог (/symbiont:status src/core) — придёт карта именно этой части проекта.',
  },
  {
    cmd: '/symbiont:graph',
    text: 'Карта проекта в браузере, которую можно трогать: узлы тянутся мышью, размер показывает важность модуля, свечение — недавнюю работу, цвет — часть проекта, клик открывает роль файла и обе стороны связей. Аргументом можно назвать каталог (/symbiont:graph src/core) — тогда рисуется только он. Один самодостаточный файл, ноль внешних запросов, ни строки кода внутри.',
  },
  {
    cmd: '/symbiont:health',
    text: 'Три ответа: соблюдаются ли выведенные правила сейчас, куда всё движется относительно прошлых замеров и где чаще всего чинят — файлы, в которые баг-фиксы возвращаются снова и снова. Последнее — кандидаты на рефакторинг, выбранные данными, а не ощущением.',
  },
  {
    cmd: '/symbiont:init',
    text: 'Разобрать проект сразу и целиком, не дожидаясь, пока он дозреет в фоне: правила, карта связей, роли ключевых модулей, первый замер здоровья. От секунд до нескольких минут. Повторный вызов безопасен — ничего не задваивается, доберётся только недостающее.',
  },
  {
    cmd: '/symbiont:charter',
    text: 'Записать словами то, чего из кода не видно: «сервис не ходит в сеть», «legacy-модуль заморожен намеренно», «приватность важнее скорости». Известное системе отсечётся как лишнее, уникальное будет приходить в каждой сессии.',
  },
  {
    cmd: '/symbiont:elevate',
    text: 'Разбор «что стоит улучшить и в каком порядке» — архитектура, надёжность, производительность, безопасность, данные, доступность, удобство. Каждое предложение опирается на отраслевые стандарты и на конвенции самого проекта и проходит состязательную самопроверку. Ничего не меняет — это карта возможностей. Единственная дорогая команда.',
  },
]

const roadmap = [
  { title: 'ast-grep-гейты и бюджеты профиля', text: 'Законы компилируются в структурные правила; измеримые пороги осей не выпускают регрессию.' },
  { title: 'CI с ежедневной канарейкой', text: 'Защита от молчаливой поломки хуков при обновлении платформы — грех не поломка, а тишина.' },
  { title: 'Пейджинг контекста', text: 'При сжатии содержимое заменяется указателями на узлы паспорта: 20 токенов вместо 2000, ничего не потеряно.' },
  { title: 'Ре-заземление стандартов', text: 'Курируемая экспертиза — сид, а не потолок: Core Web Vitals, OWASP и WCAG меняются, знание должно обновляться само.' },
  { title: 'UI-канон', text: 'Эталонные компоненты зоны и матрица платформ, выведенная из истории багфиксов.' },
]

const nodeExample = `src/core/store.ts · вход:25 исход:3
роль: append-only журнал фактов паспорта (Datomic): смена вердикта
      вытесняет старую запись, история полна
зависят: ratings.ts, schedule.ts · правятся вместе: mcp.ts (4)

эффективные условия зоны app/legacy (каскад профиля): зона
объявлена устаревшей — менять минимально`

const starMap = `  Symbiont · my-app · 1312 узлов · 2187 рёбер · 489 контент-сущностей

  server/  ███▓▓▓▓▒▒▒▒░░░   ✦ db/schema/index.ts   вход 136
  shared/  █████▓▓▓▓▓▓▓▓▓   ✦ decode.ts             вход 115
  app/     ▓▒░░░░░░░░░░░░
                |
       ⚠ 26 сирот · 142 дубля анкоров в перелинковке`

const progress = ref(0)
const onScroll = () => {
  const doc = document.documentElement
  const total = doc.scrollHeight - doc.clientHeight
  progress.value = total > 0 ? Math.min(100, (doc.scrollTop / total) * 100) : 0
}

const theme = ref('dark')
const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  try {
    localStorage.setItem('symbiont-theme', theme.value)
  } catch (e) {}
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  // восстановление сохранённой темы: писали в localStorage, но не читали — вечно тёмная
  let saved = null
  try {
    saved = localStorage.getItem('symbiont-theme')
  } catch (e) {}
  theme.value = saved === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="page">
    <div class="progress" :style="{ width: progress + '%' }" />

    <button class="theme-btn" type="button" @click="toggleTheme">
      {{ theme === 'dark' ? '☀ Светлая' : '🌙 Тёмная' }}
    </button>

    <!-- HERO -->
    <header class="hero">
      <div class="hero__mark">🧬</div>
      <h1 class="hero__title">Symbiont</h1>
      <p class="hero__sub">Живой паспорт проекта для Claude Code</p>
      <p class="hero__tag">
        Плагин, который читает проект целиком и делает модель быстрее, точнее и дешевле —
        на любом продукте, языке и направлении, без единой строки хардкода.
      </p>
      <div class="hero__pillars">
        <span>Паспорт</span><i>·</i>
        <span>Дирижёр контекста</span><i>·</i>
        <span>Принуждение</span><i>·</i>
        <span>Петля самообучения</span><i>·</i>
        <span>Фоновый садовник</span>
      </div>
    </header>

    <!-- ЧТО ДЕЛАЕТ -->
    <section class="wrap">
      <h2 class="sec-title">Что он делает</h2>
      <div class="grid">
        <div v-for="f in features" :key="f.title" class="card">
          <div class="card__icon">{{ f.icon }}</div>
          <div class="card__title">{{ f.title }}</div>
          <div class="card__text">{{ f.text }}</div>
        </div>
      </div>
    </section>

    <!-- КАК ВЫГЛЯДИТ -->
    <section class="wrap">
      <h2 class="sec-title">Как это выглядит</h2>
      <p class="lead">Знание приходит <b>по месту работы</b> — открыли файл, пришла его роль, связи и условия зоны:</p>
      <pre class="term">{{ nodeExample }}</pre>
      <p class="lead">А <code>/symbiont:graph</code> собирает <b>интерактивную карту</b> — один HTML-файл, открывается офлайн: узлы тянутся мышью, размер показывает важность модуля, цвет — зону, клик раскрывает роль узла, его связи и условия зоны.</p>
      <img class="shot" src="/graph-preview.svg" alt="Карта проекта: узлы модулей, связи, важность и зоны" loading="lazy">
      <p class="cap">Настоящая карта репозитория Symbiont — сгенерирована из его же паспорта, а не нарисована</p>
    </section>

    <!-- КАК УСТРОЕН -->
    <section class="wrap">
      <h2 class="sec-title">Как устроен</h2>
      <p class="lead">Три этажа и петля самообучения. Знание течёт по кругу и накапливается — качество движется только вверх.</p>
      <div class="floors">
        <div class="floor"><b>🗂 Паспорт</b><span>карта · конвенции · граф сущностей · роли узлов · профиль качества по зонам · конституция · плейбуки</span></div>
        <div class="floor__arrow">↓ читает</div>
        <div class="floor"><b>📡 Подача</b><span>6 каналов + MCP + стол — что модель знает и когда, с оглядкой на окупаемость</span></div>
        <div class="floor__arrow">↓</div>
        <div class="floor"><b>🔒 Принуждение</b><span>гейты формы · верификаторы направления · страж защиты · страж фокуса</span></div>
        <div class="floor__arrow">↓</div>
        <div class="floor"><b>🔄 Петля</b><span>правки владельца · старение фактов · окупаемость подачи</span></div>
        <div class="floor__arrow">↓ назначает работы</div>
        <div class="floor"><b>🌱 Садовник (фон)</b><span>углубление паспорта · дрейф и hotspot-зоны · честность карты · самолечение — без команд</span></div>
        <div class="floor__arrow">↑ чинит и углубляет паспорт</div>
      </div>
    </section>

    <!-- КОМАНДЫ -->
    <section class="wrap">
      <h2 class="sec-title">Команды</h2>
      <p class="lead">Их минимум, и это осознанно: работа автономна. Команда нужна лишь там, где человек <b>сам пришёл</b> посмотреть или высказать волю — всё остальное система делает в фоне, ничего не спрашивая.</p>
      <div class="cmds">
        <div v-for="c in commands" :key="c.cmd" class="cmd cmd--doc">
          <code>{{ c.cmd }}</code>
          <span>{{ c.text }}</span>
        </div>
      </div>
    </section>

    <!-- ЧТО ДАЛЬШЕ -->
    <section class="wrap">
      <h2 class="sec-title">Что дальше</h2>
      <p class="lead">Ядро построено и обкатано на боевых проектах. В работе:</p>
      <div class="cmds">
        <div v-for="r in roadmap" :key="r.title" class="cmd cmd--road">
          <b>{{ r.title }}</b>
          <span>{{ r.text }}</span>
        </div>
      </div>
    </section>

    <!-- УСТАНОВКА -->
    <section class="wrap">
      <h2 class="sec-title">Установка</h2>
      <pre class="term">claude plugin marketplace add &lt;репозиторий-symbiont&gt;
claude plugin install symbiont@symbiont-market</pre>
      <p class="lead lead--muted">Ставится собранный артефакт ~27 МБ, а не исходники с зависимостями. Данные локальные, переживают обновления плагина. Код никуда не уезжает. Ноль демонов и портов: всё событийное просыпается от хука, работает и умирает. Хранилище — читаемые файлы + SQLite, без векторных БД и эмбеддингов.</p>
    </section>

    <footer class="footer">Symbiont · {{ new Date().getFullYear() }} · закрытая лицензия · владелец: skyproboost</footer>
  </div>
</template>

<style>
:root {
  --bg: #0b0f0d;
  --bg-soft: #10161276;
  --panel: #121a15;
  --line: #223328;
  --text: #d9e5dc;
  --muted: #8fa596;
  --accent: #4ade80;
  --accent-dim: #22c55e33;
  --heading: #eafff1;
  --strong: #f0fff5;
  --code: #b7d4bf;
  --glow: #123d2422;
}

html[data-theme='light'] {
  --bg: #f6f8f6;
  --bg-soft: #eef3ef;
  --panel: #ffffff;
  --line: #d9e4db;
  --text: #24322a;
  --muted: #5b6f61;
  --accent: #15803d;
  --accent-dim: #16a34a22;
  --heading: #122b1c;
  --strong: #0c2013;
  --code: #1f4630;
  --glow: #16a34a11;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }

.progress { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); z-index: 50; transition: width .1s; }

.theme-btn { position: fixed; top: 16px; right: 16px; z-index: 40; cursor: pointer;
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 999px; padding: 7px 14px; font-size: 13px; }
.theme-btn:hover { border-color: var(--accent); }

/* HERO */
.hero { text-align: center; padding: 110px 20px 70px;
  background: radial-gradient(ellipse 80% 60% at 50% 0%, var(--glow), transparent 70%); }
.hero__mark { font-size: 64px; filter: drop-shadow(0 0 24px var(--accent-dim)); }
.hero__title { font-size: clamp(48px, 9vw, 84px); margin: 8px 0 0; letter-spacing: -.03em;
  color: var(--strong); font-weight: 800; }
.hero__sub { font-size: clamp(18px, 3vw, 24px); color: var(--accent); margin: 6px 0 22px; font-weight: 600; }
.hero__tag { max-width: 640px; margin: 0 auto; font-size: 18px; color: var(--muted); }
.hero__pillars { margin-top: 30px; color: var(--muted); font-size: 14px; letter-spacing: .04em; }
.hero__pillars span { color: var(--text); }
.hero__pillars i { color: var(--accent); margin: 0 10px; font-style: normal; }

/* SECTIONS */
.wrap { max-width: 980px; margin: 0 auto; padding: 46px 22px; }
.sec-title { font-size: 30px; color: var(--heading); margin: 0 0 6px; letter-spacing: -.02em; }
.sec-title::after { content: ''; display: block; width: 46px; height: 3px; background: var(--accent); border-radius: 3px; margin-top: 12px; }
.lead { color: var(--muted); font-size: 17px; max-width: 720px; margin: 18px 0; }
.lead--muted { font-size: 15px; }
.lead b { color: var(--strong); }
.lead code, .cmd code, p code { background: var(--accent-dim); color: var(--accent); padding: 1px 7px; border-radius: 6px; font-size: .92em; }

/* FEATURES GRID */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 26px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; transition: .18s; }
.card:hover { border-color: var(--accent); transform: translateY(-3px); }
.card__icon { font-size: 30px; margin-bottom: 12px; }
.card__title { color: var(--strong); font-weight: 700; font-size: 18px; margin-bottom: 8px; }
.card__text { color: var(--muted); font-size: 15px; }

/* TERMINAL BLOCKS */
.term { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 22px; overflow-x: auto; font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 13.5px; line-height: 1.65; color: var(--code); white-space: pre; }
.term--dim { color: var(--muted); }
.shot { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 12px; margin-top: 6px; }
.cap { color: var(--muted); font-size: 13px; text-align: center; margin: 10px 0 0; }

/* FLOORS */
.floors { margin-top: 26px; }
.floor { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 10px; padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; }
.floor b { color: var(--strong); font-size: 17px; }
.floor span { color: var(--muted); font-size: 14px; }
.floor__arrow { text-align: center; color: var(--accent); font-size: 13px; padding: 8px 0; letter-spacing: .04em; }

/* COMMANDS */
.cmds { margin-top: 24px; display: flex; flex-direction: column; gap: 10px; }
.cmd { display: flex; align-items: baseline; gap: 16px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; }
.cmd code { flex: 0 0 auto; font-weight: 600; }
.cmd span { color: var(--muted); font-size: 15px; }
/* команды: имя строкой выше описания — описания подробные, в строку не влезают */
.cmd--doc { flex-direction: column; align-items: flex-start; gap: 7px; }
.cmd--doc code { font-size: 14px; }
/* дорожная карта: заголовок строкой выше описания, без моноширинного кода */
.cmd--road { flex-direction: column; align-items: flex-start; gap: 5px; }
.cmd--road b { color: var(--strong); font-size: 16px; }

.footer { text-align: center; color: var(--muted); font-size: 13px; padding: 50px 20px 70px; border-top: 1px solid var(--line); margin-top: 40px; }

@media (max-width: 640px) {
  .cmd { flex-direction: column; gap: 4px; }
  .hero { padding-top: 80px; }
}
</style>
