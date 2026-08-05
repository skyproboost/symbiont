/**
 * Вклейка чужих файлов в собственные промпты плагина.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ. Пять мест (слой 2, возвышение, роли узлов, неизвестный
 * материал, разбор поправок) вклеивали образцы строкой `=== путь ===`. Разделитель
 * из простого текста неотличим от самого текста: баннерный комментарий вида
 * `// === Config ===` — обычный стиль, а в markdown и reStructuredText строки из
 * `=` вообще служат подчёркиванием заголовка. Там, где модель ищет границу файла,
 * появляется вторая, ложная.
 *
 * ПОЧЕМУ ЭТО НЕ КОСМЕТИКА. Symbiont разбирает ЧУЖИЕ проекты, то есть содержимое
 * файлов — недоверенный ввод, а выведенные из него правила уходят в журнал фактов,
 * который append-only: ложное правило оттуда уже не убрать. Проект этот класс
 * угрозы признаёт — тема коммита обезврежена перед показом (renderGitBlock,
 * тест «инъекция в commit-месседже обезврежена»), — но образцы кода шли в промпт
 * сырыми. Документация Anthropic предписывает для этого случая XML-структуру
 * documents/document/source/document_content: она «снижает неверное истолкование»
 * именно потому, что закрывающий тег — не текст, который встречается сам собой.
 *
 * Полной защиты от инъекции разметка не даёт (её вообще не даёт ничто на уровне
 * промпта), поэтому закрывающие теги внутри содержимого экранируются: граница
 * остаётся однозначной даже на файле, написанном специально против нас.
 */

export interface Sample {
  file: string
  content: string
}

/**
 * Экранирование закрывающего тега внутри содержимого.
 *
 * Отвергнут вариант «вырезать»: файл проекта попадает в промпт как улика, и
 * молча съеденный фрагмент исказил бы вывод правила. Здесь строка остаётся
 * читаемой, но перестаёт быть границей.
 */
const OUR_TAGS = /<\/(documents|document_content|document|source|revisions|revision|model_wrote|owner_corrected_to)\b/g
const neutralize = (text: string): string => text.replace(OUR_TAGS, '<\\/$1')

/**
 * Образцы файлов как документы. Порядок сохраняется: он несёт вес (первым идёт
 * самый связный файл), а нумерация даёт модели способ сослаться на конкретный.
 */
export function documentsBlock(samples: Sample[]): string {
  if (samples.length === 0) return ''
  const lines: string[] = ['<documents>']
  for (let i = 0; i < samples.length; i++) {
    lines.push(
      `<document index="${i + 1}">`,
      '<source>',
      samples[i].file,
      '</source>',
      '<document_content>',
      neutralize(samples[i].content),
      '</document_content>',
      '</document>',
    )
  }
  lines.push('</documents>')
  return lines.join('\n')
}

/**
 * Пара «было → стало» для разбора поправок владельца. Та же причина, что выше:
 * разделители `--- ассистент написал: ---` жили внутри диффа как обычный текст.
 */
export function revisionsBlock(items: Array<{ file: string; before: string; after: string }>): string {
  if (items.length === 0) return ''
  const lines: string[] = ['<revisions>']
  for (let i = 0; i < items.length; i++) {
    lines.push(
      `<revision index="${i + 1}">`,
      '<source>',
      items[i].file,
      '</source>',
      '<model_wrote>',
      neutralize(items[i].before),
      '</model_wrote>',
      '<owner_corrected_to>',
      neutralize(items[i].after),
      '</owner_corrected_to>',
      '</revision>',
    )
  }
  lines.push('</revisions>')
  return lines.join('\n')
}
