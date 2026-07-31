import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classify, artifactProfile, activeAxes, renderArtifacts, renderQualityStance } from '../src/passport/artifacts'
import { buildPassport } from '../src/passport/build'

describe('classify', () => {
  it('код/контент/данные/дизайн/офис/инфра по расширению и имени', () => {
    expect(classify('a.ts', '.ts')).toBe('код')
    expect(classify('post.md', '.md')).toBe('контент')
    expect(classify('data.csv', '.csv')).toBe('данные')
    expect(classify('logo.psd', '.psd')).toBe('дизайн')
    expect(classify('deck.pptx', '.pptx')).toBe('офис')
    expect(classify('Dockerfile', '')).toBe('конфиг-инфра')
    expect(classify('.github/workflows/ci.yml', '.yml')).toBe('конфиг-инфра')
    expect(classify('weird.xyz', '.xyz')).toBe('прочее')
  })
})

const files = (list: string[]) => list.map((p) => ({ name: p, ext: p.slice(p.lastIndexOf('.')) }))

describe('artifactProfile', () => {
  it('распределение, доминанта и заметные классы', () => {
    const p = artifactProfile(files([
      'a.ts', 'b.ts', 'c.ts', 'd.ts', // код доминирует
      'x.md', 'y.md', 'z.md', // контент заметен (3)
      'once.png', // дизайн — 1, ниже порога
    ]))
    expect(p.dominant).toBe('код')
    expect(p.present).toContain('код')
    expect(p.present).toContain('контент')
    expect(p.present).not.toContain('дизайн') // 1 файл < порога
  })

  it('контентный проект без кода: доминанта — контент', () => {
    const p = artifactProfile(files(['s1.md', 's2.md', 's3.md', 's4.md', 'data.csv', 'data2.csv', 'data3.csv']))
    expect(p.dominant).toBe('контент')
    expect(p.present).toEqual(expect.arrayContaining(['контент', 'данные']))
  })
})

describe('activeAxes', () => {
  it('безопасность и корректность — всегда; остальное от материала', () => {
    const codeAxes = activeAxes(artifactProfile(files(['a.ts', 'b.ts', 'c.ts'])))
    expect(codeAxes).toContain('безопасность')
    expect(codeAxes).toContain('корректность')
    expect(codeAxes).toContain('производительность')

    const contentAxes = activeAxes(artifactProfile(files(['a.md', 'b.md', 'c.md'])))
    expect(contentAxes).toContain('находимость/SEO')
    expect(contentAxes).toContain('связность/перелинковка')
    expect(contentAxes).toContain('безопасность') // всё равно всегда
  })

  it('пустой профиль — только вечные оси', () => {
    expect(activeAxes(artifactProfile([]))).toEqual(['безопасность', 'корректность'])
  })

  it('инфра-материал активирует масштабируемость', () => {
    const axes = activeAxes(artifactProfile(files(['Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'nginx.conf'])))
    expect(axes.join(' ')).toContain('масштабируемость')
  })
})

describe('renderArtifacts', () => {
  it('секция с составом и активными осями; пустой — пусто', () => {
    const block = renderArtifacts(artifactProfile(files(['a.ts', 'b.ts', 'c.ts', 'r.md', 's.md', 't.md'])))
    expect(block).toContain('Состав проекта')
    expect(block).toContain('код —')
    expect(block).toContain('активные оси качества')
    expect(renderArtifacts(artifactProfile([]))).toBe('')
  })
})

describe('renderQualityStance', () => {
  it('пара амбиция+сдержанность, оси из состава (без хардкода)', () => {
    const s = renderQualityStance(artifactProfile(files(['a.ts', 'b.ts', 'c.ts', 'r.md', 's.md', 't.md'])))
    expect(s).toContain('Стойка качества')
    expect(s).toContain('топ-1 по осям')
    expect(s).toContain('безопасность') // вечная ось
    expect(s).toContain('находимость/SEO') // от контента
    expect(s).toContain('предлагать, не делать') // сдержанность
  })
  it('пустой состав — нет стойки', () => {
    expect(renderQualityStance(artifactProfile([]))).toBe('')
  })
})

describe('состав артефактов в конвейере', () => {
  it('смешанный проект: секция «Состав проекта» в сводке', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-art-'))
    mkdirSync(join(proj, 'content'))
    // код + контент + данные
    const CODE = 'function f() {\n\tvar x = 1;\n\treturn x;\n}\n'
    for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), CODE.repeat(12))
    for (let i = 0; i < 4; i++) writeFileSync(join(proj, 'content', `a${i}.md`), '# статья')
    writeFileSync(join(proj, 'data.csv'), 'a,b,c\n1,2,3')
    writeFileSync(join(proj, 'data2.csv'), 'x,y\n1,2')
    writeFileSync(join(proj, 'data3.csv'), 'p,q\n3,4')

    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-art-data-'))
    const r = buildPassport(proj, dataDir)
    const summary = readFileSync(r.summaryPath, 'utf8')
    expect(summary).toContain('Состав проекта')
    expect(summary).toContain('контент/тексты')
    expect(summary).toContain('данные')
    expect(summary).toContain('связность/перелинковка') // активирована контентом
    expect(summary).toContain('Стойка качества') // стоячая стойка в сводке
    expect(summary).toContain('предлагать, не делать') // сдержанность

    rmrf(proj)
    rmrf(dataDir)
  })
})
