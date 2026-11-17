'use client'

import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@ui-sdk/react/select'

export type TypeOption = { value: string; label: string; href: string }

export function TypeFilter({ label, value, options }: { label: string; value: string; options: TypeOption[] }) {
  const router = useRouter()
  return (
    <Select
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      value={value}
      onValueChange={(v) => {
        const o = options.find((x) => x.value === v)
        if (o && o.value !== value) router.push(o.href)
      }}
    >
      <SelectLabel className="label">{label}</SelectLabel>
      <SelectTrigger className="select-trigger">
        <SelectValue />
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </SelectTrigger>
      <SelectContent className="select-content">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="select-item">
            {o.label}
            <SelectItemIndicator className="select-check">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
                <path d="m2.5 6.5 2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
