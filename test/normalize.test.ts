import { describe, expect, test } from 'vitest'
import { cleanText, isPoBox, nameSimilarity, nameTokens, normStreet, sameName } from '@/sync/normalize'

describe('normStreet', () => {
  test('suffix and direction variants', () => {
    expect(normStreet('210 Orchard Lane')).toBe(normStreet('210 Orchard Ln'))
    expect(normStreet('4850 Northwest Sylvania Avenue')).toBe(normStreet('4850 NW Sylvania Ave'))
    expect(normStreet('199 Barks Road West')).toBe(normStreet('199 Barks Rd W'))
    expect(normStreet('3313 Wilmington Pk')).toBe(normStreet('3313 Wilmington Pike'))
  })
  test('prototype keys are plain words', () => {
    expect(normStreet('1 Constructor ToString')).toBe('1 constructor tostring')
  })
  test('St as Saint is kept', () => {
    expect(normStreet('45 St Lawrence Dr')).toBe('45 st lawrence dr')
  })
})

test('isPoBox', () => {
  expect(isPoBox('PO Box 517') && isPoBox('P.O. Box 9') && !isPoBox('3156 W Prospect Rd')).toBe(true)
})

test('decodes entities', () => {
  expect(cleanText('Bellhaven Rehabilitation &amp; Nursing  of Grove City ')).toBe(
    'Bellhaven Rehabilitation & Nursing of Grove City',
  )
  expect(cleanText('a\u200bb')).toBe('ab')
})

test('sameName', () => {
  expect(sameName('Bellhaven of Owosso', ' bellhaven  of owosso')).toBe(true)
  expect(sameName('Bellhaven Rehab and Nursing of Grove City', 'Bellhaven Rehabilitation & Nursing of Grove City')).toBe(false)
  expect(sameName('Bellhaven of Sycamore Ridge', 'Bellhaven at Sycamore Ridge')).toBe(false)
})

test('nameTokens and similarity', () => {
  expect([...nameTokens('Bellhaven of Tiffin')]).toEqual(['tiffin'])
  expect(nameSimilarity('Bellhaven', 'The Senior Living')).toBe(1)
  expect(nameSimilarity('Bellhaven of Tiffin', 'Tiffin Care Center')).toBe(1)
  expect(nameSimilarity('Bellhaven of Tiffin', 'Bellhaven of Erie')).toBe(0)
})
