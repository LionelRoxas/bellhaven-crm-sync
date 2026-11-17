import { NextResponse, type NextRequest } from 'next/server'

/**
 * Local-only guard: refuse any request whose Host isn't this machine. Blocks DNS-rebinding pages,
 * which would otherwise pass Next's Origin-equals-Host check on Server Actions.
 */
export function proxy(request: NextRequest) {
  const port = request.nextUrl.port
  const host = request.headers.get('host') ?? ''
  const allowed = port !== '' && (host === `127.0.0.1:${port}` || host === `localhost:${port}`)
  if (!allowed) return new NextResponse('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } })
  return NextResponse.next()
}
