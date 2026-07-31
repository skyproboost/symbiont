/**
 * Рубрика возвышения: универсальная база «что делает продукт топ-1» —
 * курируемая, едет с плагином, ноль LLM-токенов. Заземлена на авторитетные
 * стандарты (ISO/IEC 25010:2023, Core Web Vitals, WCAG 2.2, OWASP Top 10:2025,
 * DAMA, Google SRE, Nielsen), а НЕ на мнение одного человека.
 *
 * Оси = линзы (модель их знает); рубрика говорит, ЧТО смотреть, с какими
 * объективными порогами и откуда это. Применимость — по классам артефактов
 * (см. artifacts.ts), поэтому рубрика универсальна: код/контент/дизайн/данные.
 *
 * DESIGN_PRINCIPLES — «от обратного»: правила, которыми /sym-elevate избегает
 * болезней аудиторов (шум, метрики-Goodhart, карго-культ, ложная уверенность).
 */
import type { ArtifactClass } from '../passport/artifacts'

export interface RubricAxis {
  axis: string
  /** Отображение на ISO/IEC 25010:2023, где применимо. */
  iso?: string
  /** Классы артефактов, к которым ось применима. */
  appliesTo: ArtifactClass[]
  /** Линза: главный вопрос оси. */
  lens: string
  /** Конкретное, что инспектировать (атомы, а не композитный балл). */
  checks: string[]
  /** Объективные пороги с числами, где стандарт их даёт. */
  thresholds?: string[]
  /** Авторитетный источник. */
  source: string
}

export const RUBRIC: RubricAxis[] = [
  {
    axis: 'корректность',
    iso: 'Functional suitability',
    appliesTo: ['код', 'данные', 'контент', 'конфиг-инфра'],
    lens: 'делает ли артефакт то, что должен, без тихих ошибок',
    checks: ['пути ошибок без обработки', 'битые ссылки/ссылочная целостность', 'граничные случаи и валидация входа', 'соответствие заявленному поведению'],
    source: 'ISO/IEC 25010:2023 — https://www.iso.org/standard/78176.html',
  },
  {
    axis: 'производительность',
    iso: 'Performance efficiency',
    appliesTo: ['код', 'разметка-стили', 'медиа', 'данные'],
    lens: 'цена на горячем пути и скорость для пользователя',
    checks: ['аллокации/чтения в циклах', 'размер бандла и ассетов', 'лишние проходы по данным', 'N+1 запросы', 'кэширование'],
    thresholds: ['Core Web Vitals (p75): LCP ≤ 2.5с · INP ≤ 200мс · CLS ≤ 0.1'],
    source: 'web.dev Web Vitals — https://web.dev/articles/vitals',
  },
  {
    axis: 'отказоустойчивость',
    iso: 'Reliability',
    appliesTo: ['код', 'конфиг-инфра', 'данные'],
    lens: 'что будет при сбое — деградация или падение в ноль',
    checks: ['обработка отказов внешних вызовов', 'ретраи/таймауты/идемпотентность', 'graceful degradation', 'восстановление после краша'],
    thresholds: ['SRE golden signals: latency (p50/p95/p99), traffic, errors, saturation'],
    source: 'Google SRE — https://sre.google/sre-book/monitoring-distributed-systems/',
  },
  {
    axis: 'безопасность',
    iso: 'Security',
    appliesTo: ['код', 'конфиг-инфра', 'данные'],
    lens: 'какой вход без проверки и что можно ослабить',
    checks: ['контроль доступа (BOLA/BFLA)', 'валидация на границе не обойдена', 'секреты в коде/логах', 'уязвимые зависимости (supply chain)', 'обработка исключений не глотает ошибки'],
    thresholds: ['0 находок OWASP Top 10:2025 · ASVS L2 как дефолт-цель для чувствительных данных'],
    source: 'OWASP Top 10:2025 — https://owasp.org/Top10/2025/ · ASVS — https://asvs.dev/',
  },
  {
    axis: 'поддерживаемость',
    iso: 'Maintainability',
    appliesTo: ['код', 'данные'],
    lens: 'легко ли это менять, не ломая',
    checks: ['дублирование логики', 'глубина вложенности/длина функций', 'связность модулей', 'тестируемость', 'следование конвенциям проекта'],
    source: 'ISO/IEC 25010:2023 (modularity, analysability, modifiability, testability)',
  },
  {
    axis: 'доступность',
    iso: 'Interaction capability',
    appliesTo: ['разметка-стили', 'дизайн', 'контент', 'офис'],
    lens: 'работает ли без мыши и со скринридером',
    checks: ['контраст текста', 'размер целей нажатия', 'alt/aria/семантика', 'фокус и клавиатурная навигация', 'POUR (Perceivable/Operable/Understandable/Robust)'],
    thresholds: ['WCAG 2.2 AA: контраст ≥ 4.5:1 (крупный 3:1) · цель ≥ 24×24 CSS px'],
    source: 'W3C WCAG 2.2 — https://www.w3.org/TR/WCAG22/',
  },
  {
    axis: 'находимость/SEO',
    appliesTo: ['контент', 'разметка-стили'],
    lens: 'что увидит краулер и заслуживает ли контент доверия',
    checks: ['мета/OG/каноникал/структурные данные', 'краулимость и индексируемость', 'E-E-A-T: опыт/экспертиза/авторитет/доверие', 'тест «Кто/Как/Зачем» (авторство, методология, польза людям)', 'перелинковка не порвана'],
    source: 'Google Helpful Content / E-E-A-T — https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  },
  {
    axis: 'целостность данных',
    appliesTo: ['данные', 'код'],
    lens: 'можно ли доверять данным и переживут ли их изменения схемы',
    checks: ['accuracy/completeness/consistency/timeliness/validity/uniqueness (6 измерений DAMA)', 'обратимость и совместимость миграций (expand-contract)', 'ссылочная целостность и явные ограничения'],
    source: 'DAMA — https://www.dama-nl.org/wp-content/uploads/2020/09/DDQ-Dimensions-of-Data-Quality-Research-Paper-version-1.2-d.d.-3-Sept-2020.pdf',
  },
  {
    axis: 'совместимость',
    iso: 'Compatibility / Flexibility',
    appliesTo: ['код', 'разметка-стили'],
    lens: 'переживёт ли это чужую среду, старый браузер, слабое устройство',
    checks: ['API за пределами матрицы платформ', 'мягкая деградация вместо белого экрана', 'портируемость/масштабируемость'],
    source: 'ISO/IEC 25010:2023 (co-existence, interoperability, adaptability, scalability)',
  },
  {
    axis: 'UX/эргономика',
    iso: 'Interaction capability',
    appliesTo: ['код', 'разметка-стили', 'дизайн', 'офис'],
    lens: 'нет ли трения и понятно ли состояние системы',
    checks: ['10 эвристик Нильсена (видимость статуса, соответствие миру, контроль/выход, консистентность, предотвращение ошибок, узнавание>вспоминание, гибкость, минимализм, помощь в ошибках, документация)'],
    thresholds: ['HEART как метрики: Happiness/Engagement/Adoption/Retention/Task-success · SUS ≥ 68 средне, 80+ отлично'],
    source: 'Nielsen NN/g — https://www.nngroup.com/articles/ten-usability-heuristics/',
  },
  {
    axis: 'наблюдаемость',
    appliesTo: ['код', 'конфиг-инфра'],
    lens: 'увидим ли мы это в проде',
    checks: ['ошибка оставляет след с контекстом', 'метрики/логи осмысленны после правки', 'алертинг на отказы'],
    source: 'Google SRE golden signals — https://sre.google/sre-book/monitoring-distributed-systems/',
  },
  {
    axis: 'связность/перелинковка',
    appliesTo: ['контент', 'данные'],
    lens: 'встроен ли узел в сеть или висит сиротой',
    checks: ['достижимость из хабов', 'сироты и тупики', 'дубли анкоров', 'транзитивная перелинковка', 'глубина и распределение обратных ссылок'],
    source: 'граф достижимости (детерминированно) — принцип концепта Symbiont',
  },
  {
    axis: 'полнота/покрытие',
    iso: 'Functional suitability (completeness)',
    appliesTo: ['контент', 'данные', 'код', 'офис'],
    lens: 'что отсутствует, чего не хватает',
    checks: ['пробелы в покрытии темы/тестов', 'незаполненные обязательные поля', 'отсутствующие связи'],
    source: 'ISO/IEC 25010:2023 · DAMA completeness',
  },
  {
    axis: 'легитимность/контекст',
    appliesTo: ['контент', 'код'],
    lens: 'не отобьёт ли чувствительный (но легитимный) контент ложным отказом',
    checks: ['сухие правдивые факты легитимности (кто пользователи, добровольность, что сервис НЕ делает)', 'отсутствие анти-паттернов (мольбы/эмоции/персоны, повышающие отказы)', 'рассуждения в thinking, не наружу'],
    source: 'XSTest/OR-Bench + боевой CONTEXT-слой (концепт Symbiont §4.1)',
  },
  {
    axis: 'стоимость/экономия',
    appliesTo: ['код', 'конфиг-инфра', 'медиа', 'данные'],
    lens: 'не жжём ли ресурс/токены/деньги зря',
    checks: ['дорогие вызовы без кэша', 'избыточная нагрузка/трафик', 'токены на задачу (tokens-to-done), не на вызов'],
    source: 'Anthropic multi-agent economics + концепт Symbiont §6',
  },
]

/**
 * Принципы «от обратного» — как /sym-elevate избегает болезней аудиторов.
 * Каждый — из документированного провала реальных инструментов (см. источники).
 */
export const DESIGN_PRINCIPLES: Array<{ rule: string; because: string; source: string }> = [
  {
    rule: 'Молчание — это фича: без принудительного минимума находок; на здоровом артефакте — «нечего улучшать» это валидный и достойный ответ.',
    because: 'Ревьюер, обязанный что-то найти, производит шум в здоровом коде; «No issues found» должно быть первоклассным выводом.',
    source: 'Uber uReview, dev.to «AI is destroying code review» — https://www.uber.com/blog/ureview',
  },
  {
    rule: 'Ранжировать по радиусу влияния × частоте изменений, а не по строгости правила или абстрактной сложности.',
    because: 'Hotspots (часто правимый плохой код) дают 25–70% дефектов; сложность, которую не трогают, не вредит.',
    source: 'CodeScene hotspots — https://codescene.com/blog/tech-debt-examples-prioritize-technical-debt-with-codescene',
  },
  {
    rule: 'Дифференциально, не абсолютно: судить вклад изменения против базы, а не требовать переписать весь легаси.',
    because: '«Clean as You Code» — абсолютные баллы репозитория деморализуют и не действенны.',
    source: 'Clean as You Code — https://medium.com/leboncoin-tech-blog/clean-as-you-code-improving-code-quality-with-sonarqube-3f25e9eed903',
  },
  {
    rule: 'Намерение — первично: читать комментарии, историю, тесты; при неясной причине кода — молчать, а не предлагать правку.',
    because: 'Главная причина ложных срабатываний — «предположение инструмента не выполняется здесь», а не техническая ошибка.',
    source: '«Quieting the Static» arXiv 2311.07482 — https://arxiv.org/abs/2311.07482',
  },
  {
    rule: 'Проверять перед высказыванием: каждое утверждение (особенно от LLM) заземлять на компиляцию/тест/факт кода; состязательная проверка находки.',
    because: 'AI-ревьюеры галлюцинируют уверенно-неверное («Python 3.14 не существует»); ложная уверенность дороже пропуска.',
    source: 'HN Greptile-тред — https://news.ycombinator.com/item?id=46777079',
  },
  {
    rule: 'ПРИЧИНУ не угадывать: утверждение «система вывела X, потому что Y» допустимо, только если Y виден в приведённом контексте. Иначе — говорить «основание X в контексте не приведено» и снижать уверенность, а не строить предложение на догадке о механизме.',
    because: 'Модель уверенно объясняет причину, к которой не имеет доступа, и объяснение звучит правдоподобно независимо от истинности; аудит без чтения файлов структурно к этому подталкивает. Дважды случилось на детекте стека: «пришло из упоминаний в доках», хотя это объявленная зависимость.',
    source: 'Turpin et al., «Language Models Don\'t Always Say What They Think» — https://arxiv.org/abs/2305.04388',
  },
  {
    rule: 'Действенные атомы вместо композитного балла: каждая находка — конкретный рычаг, а не «57/100».',
    because: 'Maintainability Index произволен, LOC-доминирован и не подсказывает, что менять; композит геймится.',
    source: 'Teamscale/Sourcery о Maintainability Index — https://teamscale.com/blog/en/news/blog/maintainability-index',
  },
  {
    rule: 'Уверенность — только калиброванная, иначе не показывать; при сомнении — сказать об этом.',
    because: 'Фейковый confidence-score создаёт ложную срочность вокруг не-проблем.',
    source: 'HN Greptile-тред — https://news.ycombinator.com/item?id=46777079',
  },
  {
    rule: 'Рекомендовать из СОБСТВЕННЫХ конвенций проекта прежде generic best-practice; ambition под досягаемость рассуждения (локальное > переписывание архитектуры вслепую).',
    because: 'LLM — имитатор популярных паттернов (карго-культ); системные рефакторы без заземления промахиваются по архитектурной цели.',
    source: 'SEAL Queen’s arXiv 2411.04444 + «LLM cargo cult» — https://arxiv.org/pdf/2411.04444',
  },
  {
    rule: 'Объяснять каждую находку: «почему это, почему сейчас, как исправить»; зонировать сгенерированный/вендорный/легаси код по умолчанию.',
    because: 'Необъяснённое верное срабатывание функционально = шум (Johnson et al., 19/20 разработчиков).',
    source: 'ICSE 2013 Johnson study — https://pvs-studio.com/en/blog/posts/0335/',
  },
]

/** Оси рубрики, применимые к обнаруженным классам артефактов проекта. */
export function axesForArtifacts(present: ArtifactClass[]): RubricAxis[] {
  const set = new Set(present)
  return RUBRIC.filter((a) => a.appliesTo.some((c) => set.has(c)))
}
