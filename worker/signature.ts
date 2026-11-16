function hex(value: string | null | undefined, bytes: number) {
  if (!value || value.length !== bytes * 2 || !/^[a-f0-9]+$/i.test(value)) return null
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16))
}

let cachedHex: string | undefined
let cachedKey: Promise<CryptoKey> | undefined

export async function signedBody(request: Request, publicKey: string | undefined, at: number) {
  const signature = hex(request.headers.get('X-Signature-Ed25519'), 64)
  const timestamp = request.headers.get('X-Signature-Timestamp')
  const keyBytes = hex(publicKey, 32)
  if (!signature || !timestamp || !/^\d{10}$/.test(timestamp) || !keyBytes || Math.abs(at - Number(timestamp)) > 300) return null
  // Bound the unsigned request body before signature verification.
  const stream = request.body?.getReader()
  if (!stream) return null
  const encodedTime = new TextEncoder().encode(timestamp)
  const chunks = [encodedTime]
  let size = encodedTime.byteLength
  try {
    while (true) {
      const { value, done } = await stream.read()
      if (done) break
      size += value.byteLength
      if (size > 64 * 1024) {
        void stream.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const payload = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      payload.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (!cachedKey || cachedHex !== publicKey) {
      cachedHex = publicKey
      cachedKey = crypto.subtle.importKey('raw', keyBytes, 'Ed25519', false, ['verify'])
    }
    const valid = await crypto.subtle.verify('Ed25519', await cachedKey, signature, payload)
    return valid ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(payload.subarray(encodedTime.byteLength)) : null
  } catch {
    return null
  }
}
