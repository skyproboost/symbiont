/**
 * Батарея универсальности: Symbiont не предполагает ни язык, ни веб, ни код
 * вообще. Каждый мир проходит сквозной конвейер (паспорт → сводка → каналы)
 * и обязан вести себя осмысленно: факты там, где есть статистика; профиль там,
 * где есть сигналы; молчание там, где сказать нечего; ноль падений везде.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { fileMetrics } from '../src/layer1/ast'

const world = () => ({
  proj: mkdtempSync(join(tmpdir(), 'symbiont-uni-p-')),
  dataRoot: mkdtempSync(join(tmpdir(), 'symbiont-uni-d-')),
})

describe('мир 1: PHP-легаси (yii2-стиль — табы, snake_case, var-нотация полей)', () => {
  it('слой 0 выводит конвенции без единого предположения о языке', () => {
    const { proj, dataRoot } = world()
    const PHP = "<?php\nclass user_controller extends base_controller {\n\tpublic $page_title = 'x';\n\tfunction action_index($user_id) {\n\t\t$query_result = find_user($user_id);\n\t\t$page_data = build_page($query_result);\n\t\treturn $page_data;\n\t}\n}\n"
    for (let i = 0; i < 12; i++) writeFileSync(join(proj, `controller_${i}.php`), PHP.repeat(10))
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('snake_case')
    expect(ctx).toContain('табы')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('слой 1 разбирает PHP символьно (try/catch)', async () => {
    const m = await fileMetrics('.php', "<?php\ntry { risky(); } catch (Exception $e) { return null; }\n")
    if (m === null) return // пребилд php недоступен — деградация честна
    expect(m.tryCount).toBe(1)
    expect(m.catchWithReturn).toBe(1)
  })
})

describe('мир 2: Python-проект', () => {
  it('4 пробела и snake_case становятся фактами', () => {
    const { proj, dataRoot } = world()
    const PY = 'def load_user_page(user_id):\n    query_result = find_user(user_id)\n    page_data = build_page(query_result)\n    return page_data\n'
    for (let i = 0; i < 12; i++) writeFileSync(join(proj, `module_${i}.py`), PY.repeat(15))
    const ctx = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u2' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('snake_case')
    expect(ctx).toContain('4 пробела')
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 3: микс языков и расширений в одном репозитории', () => {
  it('конвейер не падает, факты выводятся из совокупной статистики, граф — из импортов', () => {
    const { proj, dataRoot } = world()
    mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src', 'core.ts'), "export const load = () => ({ id: 1 })\n".repeat(30))
    writeFileSync(join(proj, 'src', 'api.ts'), "import { load } from './core'\nexport const api = () => load()\n".repeat(20))
    writeFileSync(join(proj, 'worker.py'), 'def run_job(job_id):\n    return job_id\n'.repeat(30))
    writeFileSync(join(proj, 'legacy.php'), "<?php\nfunction old_gate($x) { return $x; }\n".repeat(30))
    writeFileSync(join(proj, 'notes.md'), '# заметки')
    writeFileSync(join(proj, 'logo.svg'), '<svg/>')
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u3' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('Паспорт проекта')
    // JIT-канал видит ts-узел графа в миксе
    const jit = handleUserPrompt({ prompt: 'посмотри core.ts', cwd: proj, session_id: 'u3' }, dataRoot)
    expect(jit.hookSpecificOutput?.additionalContext).toContain('src/core.ts')
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 4: контентный проект без единой строки кода (дизайн/тексты/ассеты)', () => {
  it('профиль качества выводится из README и файлов; стилевых законов нет; ничего не падает', () => {
    const { proj, dataRoot } = world()
    writeFileSync(join(proj, 'README.md'), 'Фотобанк и видеоархив. SEO критичен, производительность выдачи важна. Работаем с персональными данными моделей.')
    mkdirSync(join(proj, 'assets'))
    writeFileSync(join(proj, 'assets', 'shot-01.jpg'), 'x')
    writeFileSync(join(proj, 'assets', 'promo.mp4'), 'x')
    writeFileSync(join(proj, 'sitemap.xml'), '<urlset/>')
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u4' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('Профиль качества')
    expect(ctx).toContain('SEO')
    expect(ctx).toContain('приватность')
    expect(ctx).not.toContain('Законы стиля') // кода нет — стилевых вердиктов нет
    // Касание ассета PostToolUse-ом — молчание, не ошибка
    const pt = handlePostTool({ cwd: proj, session_id: 'u4', tool_name: 'Read', tool_input: { file_path: join(proj, 'assets', 'shot-01.jpg') } }, dataRoot)
    expect(pt).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 5: пустой каталог (просто рассуждение на тему)', () => {
  it('полное молчание всех каналов, heartbeat есть, ноль падений', () => {
    const { proj, dataRoot } = world()
    expect(handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u5' }, dataRoot).hookSpecificOutput).toBeUndefined()
    expect(handleUserPrompt({ prompt: 'поговорим о стратегии продукта', cwd: proj, session_id: 'u5' }, dataRoot)).toEqual({})
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-sessionstart.json'))).toBe(true)
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 7: Unity (C#, парные .meta, YAML-сцены — не веб и не JS)', () => {
  const CS =
    'using UnityEngine;\n\npublic class PlayerController : MonoBehaviour {\n    private Rigidbody _body;\n    void Start() {\n        _body = GetComponent<Rigidbody>();\n    }\n}\n'
  const META = 'fileFormatVersion: 2\nguid: 8f2c1a9b0d4e4f1a9c3b7d5e6f8a1b2c\nMonoImporter:\n  externalObjects: {}\n'

  const unityWorld = (): { proj: string; dataRoot: string } => {
    const w = world()
    mkdirSync(join(w.proj, 'Assets', 'Scripts'), { recursive: true })
    mkdirSync(join(w.proj, 'ProjectSettings'), { recursive: true })
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(w.proj, 'Assets', 'Scripts', `Controller${i}.cs`), CS.repeat(6))
      writeFileSync(join(w.proj, 'Assets', 'Scripts', `Controller${i}.cs.meta`), META)
    }
    writeFileSync(join(w.proj, 'Assets', 'Main.unity'), '%YAML 1.1\n--- !u!29 &1\nOcclusionCullingSettings:\n  m_ObjectHideFlags: 0\n')
    writeFileSync(join(w.proj, 'ProjectSettings', 'ProjectSettings.asset'), '%YAML 1.1\nPlayerSettings:\n  productName: Игра\n')
    writeFileSync(join(w.proj, 'README.md'), 'Мобильная игра на Unity. Производительность на слабых устройствах критична.')
    return w
  }

  it('движок опознан, отступы выведены, веб-оси не выдуманы', () => {
    const { proj, dataRoot } = unityWorld()
    const ctx = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u7' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('unity')
    expect(ctx).toContain('4 пробела')
    expect(ctx).toContain('производительность')
    // ни SEO, ни перелинковки: веб-осям тут неоткуда взяться
    expect(ctx).not.toContain('SEO')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('приватные поля C# не рождают ложный закон snake_case', () => {
    // Ловушка реальная: 72 присваивания одному `_body` давали «идентификаторы —
    // snake_case, 72 из 72 (100%)» на коде, где ни одного snake-имени нет
    const { proj, dataRoot } = unityWorld()
    const ctx = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u7b' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).not.toContain('snake_case')
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 8: презентации и бинарные документы (материал без исходного кода вообще)', () => {
  it('состав назван, направление выведено, ни одного вердикта о стиле', () => {
    const { proj, dataRoot } = world()
    mkdirSync(join(proj, 'decks'), { recursive: true })
    for (let i = 0; i < 8; i++) writeFileSync(join(proj, 'decks', `квартал-${i}.pptx`), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    writeFileSync(join(proj, 'decks', 'итоги.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46]))
    writeFileSync(join(proj, 'README.md'), 'Материалы для инвесторов: презентации по кварталам, отчёты, айдентика.')
    const ctx = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u8' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('офис-документы')
    expect(ctx).toContain('документы')
    expect(ctx).not.toContain('Законы стиля')
    // бинарь, прочитанный как текст, не должен порождать «конвенции»
    expect(ctx).not.toContain('идентификаторы')
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('мир 6: кириллические имена, пробелы в путях, глубокая вложенность', () => {
  it('слаг и конвейер переживают недружелюбные пути', () => {
    const base = mkdtempSync(join(tmpdir(), 'symbiont-uni-ru-'))
    const proj = join(base, 'Мой Проект (архив)')
    mkdirSync(join(proj, 'глубоко', 'ещё глубже'), { recursive: true })
    writeFileSync(join(proj, 'глубоко', 'ещё глубже', 'скрипт.js'), "var x = 1;\n".repeat(60))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-uni-rud-'))
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'u6' }, dataRoot)
    expect(() => out.hookSpecificOutput?.additionalContext).not.toThrow()
    expect(slugOf(proj).length).toBeGreaterThan(0)
    rmrf(base)
    rmrf(dataRoot)
  })
})
