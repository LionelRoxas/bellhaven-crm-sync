import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Public_Sans } from 'next/font/google'
import Link from 'next/link'
import { connection } from 'next/server'
import { getDb } from '@/server/deps'
import { safeHref, utc } from './components/format'
import './globals.css'

const sans = Public_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'Bellhaven CRM sync',
  description: 'Review proposed CRM ownership changes for Bellhaven locations.',
}

/** The optional CRM browser link: http(s) only, and never one that carries the CRM token. */
function crmBrowserUrl(): string | null {
  const href = safeHref(process.env.CRM_BROWSER_URL)
  const token = process.env.CRM_TOKEN
  if (!href || (token && href.includes(token))) return null
  return href
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection()
  const run = getDb().lastRunInfo()
  const crmHref = crmBrowserUrl()
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <header className="top">
          <div className="top-inner">
            <Link className="brand" href="/">
              Bellhaven CRM sync
            </Link>
            <span className="top-meta">
              {!run
                ? 'No runs yet'
                : run.error
                  ? `Last run failed ${utc(run.startedAt)}`
                  : run.finishedAt
                    ? `Last run ${utc(run.finishedAt)}`
                    : `Run in progress since ${utc(run.startedAt)}`}
            </span>
            {crmHref && (
              <a className="top-link" href={crmHref} target="_blank" rel="noreferrer noopener">
                Open CRM browser
              </a>
            )}
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  )
}
