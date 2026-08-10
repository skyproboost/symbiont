/**
 * Сообщества графа: детерминированное label propagation и мера охвата задачи.
 * Проверяется главное — кластеры совпадают со структурой, итог воспроизводим,
 * узкая задача не выглядит широкой (подсистема засчитывается от двух файлов),
 * цена чтения считается по размерам.
 */
import { describe, it, expect } from 'bun:test'
import { communityLabels, communityName, delegationView } from '../src/graph/communities'
import type { Edge } from '../src/graph/graph'

/** Три плотных кластера по каталогам + мостики между ними. */
function threeClusters(): { nodes: string[]; edges: Edge[] } {
  const nodes: string[] = []
  const edges: Edge[] = []
  for (const dir of ['a', 'b', 'c']) {
    for (let i = 0; i < 4; i++) nodes.push(`${dir}/f${i}.ts`)
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) edges.push({ from: `${dir}/f${i}.ts`, to: `${dir}/f${j}.ts` })
  }
  edges.push({ from: 'a/f0.ts', to: 'b/f0.ts' })
  edges.push({ from: 'b/f1.ts', to: 'c/f0.ts' })
  return { nodes, edges }
}

describe('communityLabels', () => {
  it('плотные кластеры получают общие метки, итог детерминирован', () => {
    const { nodes, edges } = threeClusters()
    const l1 = communityLabels(nodes, edges)
    const l2 = communityLabels(nodes, edges)
    expect([...l1.entries()]).toEqual([...l2.entries()])
    // внутри кластера метка одна
    for (const dir of ['a', 'b', 'c']) {
      const labels = new Set([0, 1, 2, 3].map((i) => l1.get(`${dir}/f${i}.ts`)))
      expect(labels.size).toBe(1)
    }
    // кластеры не слиплись в один
    const distinct = new Set(['a/f0.ts', 'b/f0.ts', 'c/f0.ts'].map((f) => l1.get(f)))
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })

  it('без рёбер метка — заявленная модульность (каталог)', () => {
    const labels = communityLabels(['a/x.ts', 'b/y.ts', 'top.ts'], [])
    expect(labels.get('a/x.ts')).toBe('a')
    expect(labels.get('b/y.ts')).toBe('b')
    expect(labels.get('top.ts')).toBe('.')
  })
})

describe('communityName', () => {
  it('имя — доминирующий каталог участников', () => {
    expect(communityName(['src/api/a.ts', 'src/api/b.ts', 'src/util/c.ts'])).toBe('src/api')
    expect(communityName(['top.ts'])).toBe('.')
  })
})

describe('delegationView — мера охвата задачи', () => {
  it('широкая задача: три подсистемы и цена чтения по размерам', () => {
    const { nodes, edges } = threeClusters()
    const labels = communityLabels(nodes, edges)
    const zone = nodes // задача накрыла всё
    const view = delegationView(zone, labels, () => 40_000) // по 40k символов на файл
    expect(view.communities).toBeGreaterThanOrEqual(2)
    expect(view.approxTokens).toBe(Math.round((40_000 * 12) / 4))
    expect(view.names.length).toBe(view.communities)
  })

  it('узкая задача: одиночное касание чужой подсистемы фронтом не считается', () => {
    const { nodes, edges } = threeClusters()
    const labels = communityLabels(nodes, edges)
    // вся зона — кластер a + ОДИН файл из b (ребро, а не фронт работ)
    const zone = ['a/f0.ts', 'a/f1.ts', 'a/f2.ts', 'b/f0.ts']
    const view = delegationView(zone, labels, () => 1000)
    expect(view.communities).toBe(1)
  })

  it('файл без метки и файл без размера не роняют меру', () => {
    const labels = communityLabels(['a/x.ts', 'a/y.ts'], [{ from: 'a/x.ts', to: 'a/y.ts' }])
    const view = delegationView(['a/x.ts', 'a/y.ts', 'призрак.ts'], labels, (f) => {
      if (f === 'a/y.ts') throw new Error('нет файла')
      return 400
    })
    expect(view.communities).toBe(1)
    expect(view.approxTokens).toBe(100)
  })
})
