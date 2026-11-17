import * as cheerio from 'cheerio'

/** Decode HTML entities, strip control and zero-width chars, collapse whitespace, trim. */
export function cleanText(s: string): string {
  // Only markup or entities need the HTML parser; plain text decodes to itself.
  const decoded = /[&<]/.test(s) ? cheerio.load(`<p>${s}</p>`, null, false)('p').text() : s
  return decoded
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, (c) =>
      /\s/.test(c) ? ' ' : '',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

const DIRECTIONS: Record<string, string> = {
  north: 'n', n: 'n', south: 's', s: 's', east: 'e', e: 'e', west: 'w', w: 'w',
  northeast: 'ne', ne: 'ne', northwest: 'nw', nw: 'nw',
  southeast: 'se', se: 'se', southwest: 'sw', sw: 'sw',
}

const DIRECTION_VALUES = new Set(Object.values(DIRECTIONS))

const SUFFIXES: Record<string, string> = {
  street: 'st', st: 'st', road: 'rd', rd: 'rd', avenue: 'ave', ave: 'ave',
  boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
  pike: 'pike', pk: 'pike', court: 'ct', ct: 'ct', place: 'pl', pl: 'pl',
  parkway: 'pkwy', pkwy: 'pkwy', highway: 'hwy', hwy: 'hwy',
}

export function normStreet(s: string): string {
  const tokens = cleanText(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (Object.hasOwn(DIRECTIONS, t) ? DIRECTIONS[t] : t))
  let i = tokens.length - 1
  if (i > 0 && DIRECTION_VALUES.has(tokens[i])) i--
  if (i > 0 && Object.hasOwn(SUFFIXES, tokens[i])) tokens[i] = SUFFIXES[tokens[i]]
  return tokens.join(' ')
}

export function isPoBox(s: string): boolean {
  return /^\s*p\.?\s*o\.?\s*box\b/i.test(s)
}

const STOPWORDS = new Set([
  'bellhaven', 'of', 'the', 'at', 'and', 'senior', 'living', 'care', 'center', 'centre',
  'healthcare', 'health', 'rehab', 'rehabilitation', 'nursing', 'campus', 'community',
  'communities', 'home', '&',
])

export function nameTokens(s: string): Set<string> {
  const words = cleanText(s).toLowerCase().match(/&|[a-z0-9]+/g) ?? []
  return new Set(words.filter((w) => !STOPWORDS.has(w)))
}

export function nameSimilarity(a: string, b: string): number {
  const x = nameTokens(a)
  const y = nameTokens(b)
  if (x.size === 0 && y.size === 0) return 1
  let inter = 0
  for (const t of x) if (y.has(t)) inter++
  return inter / (x.size + y.size - inter)
}

/** Equal after cleanText and lowercase only; any other wording difference is a real name change. */
export function sameName(a: string, b: string): boolean {
  return cleanText(a).toLowerCase() === cleanText(b).toLowerCase()
}
