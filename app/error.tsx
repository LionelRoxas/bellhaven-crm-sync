'use client'

import { useEffect } from 'react'

/** Fallback when a page can't render, usually a bad DB path or missing CRM settings. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Name only: messages can carry paths or config details.
    console.error(error instanceof Error ? error.name : 'error')
  }, [error])

  return (
    <div className="panel empty" role="alert">
      <p>
        Couldn&rsquo;t load the review queue. Check <code>DB_PATH</code> and CRM settings in <code>.env.local</code>,
        then run <code>npm run pipeline</code>.
      </p>
      <div className="buttons">
        <button className="btn" type="button" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  )
}
