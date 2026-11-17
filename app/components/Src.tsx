/** Text from the website or CRM: escaped by React, styled as quoted source data. */
export function Src({ text }: { text: string | null | undefined }) {
  if (text === null || text === undefined || text === '') return <span className="none">—</span>
  return <span className="src">{text}</span>
}
