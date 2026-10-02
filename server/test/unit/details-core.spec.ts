import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkUpload, DetailsError, mediaIdFromBytes, mediaType, parseCommentInput, parseDetails, photoIdsOf,
  readStoredDetails, readStoredPhotos,
} from '../../src/lists/details-core'

const root = join(__dirname, '..', '..', '..')
const ID = 'a'.repeat(32)

describe('details-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'lists', 'details-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'details-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  it('parseDetails normalises and drops unknown keys', () => {
    expect(parseDetails(undefined)).toEqual({})
    expect(parseDetails(null)).toEqual({})
    expect(parseDetails({ x: 1, currency: ' usd ', favorites: [' a ', ' ', ''], photos: [ID, ID], dineIn: null }))
      .toEqual({ currency: 'USD', favorites: ['a'], photos: [ID] })
    expect(parseDetails({ favorites: [], photos: [] })).toEqual({})
  })

  it('parseDetails rejects invalid values with 400', () => {
    for (const d of [[], 'x', { waitDineIn: '5' }, { recommendation: 'no' }, { currency: 'EU' }, { spendPerPerson: NaN },
      { spendPerPerson: Infinity }, { favorites: Array(11).fill('a') }, { photos: Array.from({ length: 7 }, (_, i) => String(i).repeat(32)) }]) {
      expect(() => parseDetails(d)).toThrow(DetailsError)
    }
  })

  it('media helpers', () => {
    expect(mediaIdFromBytes(new Uint8Array(16).fill(255))).toBe('f'.repeat(32))
    expect(() => mediaIdFromBytes(new Uint8Array(8))).toThrow()
    expect(mediaType('image/PNG; charset=binary')).toBe('image/png')
    expect(mediaType('image/gif')).toBeNull()
    expect(checkUpload('image/jpeg', 10)).toBe('image/jpeg')
    const status = (t: unknown, n: number) => { try { checkUpload(t, n); return 0 } catch (e) { return (e as DetailsError).status } }
    expect(status('text/plain', 10)).toBe(415)
    expect(status('image/png', 5 * 1024 * 1024 + 1)).toBe(413)
    expect(status('image/png', 5 * 1024 * 1024)).toBe(0)
    expect(status('image/png', 0)).toBe(400)
  })

  it('stored values and comment input', () => {
    expect(readStoredDetails('{"a":1}')).toEqual({ a: 1 })
    expect(readStoredDetails('nope')).toEqual({})
    expect(readStoredPhotos(`["${ID}","x"]`)).toEqual([ID])
    expect(readStoredPhotos(null)).toEqual([])
    expect(photoIdsOf([{ photos: [ID] }, {}, { photos: [ID] }])).toEqual([ID])
    expect(parseCommentInput(' hi ', undefined)).toEqual({ body: 'hi', photos: [] })
    expect(parseCommentInput(undefined, [ID])).toEqual({ body: '', photos: [ID] })
    expect(() => parseCommentInput('', [])).toThrow(DetailsError)
    expect(() => parseCommentInput(5, [ID])).toThrow(DetailsError)
    expect(() => parseCommentInput('x'.repeat(1001), [])).toThrow(DetailsError)
  })
})
