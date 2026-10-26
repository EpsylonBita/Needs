// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern.js'

const source = readFileSync(new URL('../../next.config.js', import.meta.url), 'utf8')
function patterns(url) {
  const configModule = { exports: {} }
  vm.runInNewContext(source, {
    URL, module: configModule, __dirname: fileURLToPath(new URL('../../', import.meta.url)),
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: url } },
    require: () => () => config => config,
  })
  return configModule.exports.images.remotePatterns
}

describe('profile photo image configuration', () => {
  it('permits both avatar and cover URLs only from the configured project public avatars bucket', () => {
    const configured = patterns('https://project-one.supabase.co')
    const matches = value => hasRemoteMatch([], configured, new URL(value))
    expect(matches('https://project-one.supabase.co/storage/v1/object/public/avatars/member/avatar/photo.png')).toBe(true)
    expect(matches('https://project-one.supabase.co/storage/v1/object/public/avatars/member/cover/photo.webp')).toBe(true)
    expect(matches('https://project-two.supabase.co/storage/v1/object/public/avatars/member/avatar/photo.png')).toBe(false)
    expect(matches('https://project-one.supabase.co/storage/v1/object/public/private-bucket/photo.png')).toBe(false)
    expect(matches('https://project-one.supabase.co/storage/v1/object/public/avatars/member/photo.png?token=anything')).toBe(false)
  })

  it('derives exact host and port from another configured environment', () => {
    const configured = patterns('http://127.0.0.1:54321')
    expect(hasRemoteMatch([], configured, new URL('http://127.0.0.1:54321/storage/v1/object/public/avatars/member/photo.png'))).toBe(true)
    expect(hasRemoteMatch([], configured, new URL('http://127.0.0.1:54322/storage/v1/object/public/avatars/member/photo.png'))).toBe(false)
  })
})
