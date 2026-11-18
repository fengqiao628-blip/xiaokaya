let tail: Promise<void> = Promise.resolve()
let blocked = ''
export function blockWrites(reason: string) {
  blocked = reason
}
export async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = tail
  let release!: () => void
  tail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    if (blocked) throw new Error(blocked)
    return await operation()
  } finally {
    release()
  }
}
