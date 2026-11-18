export type LifecycleEvent = { kind: 'lock' | 'sleep' | 'resume' | 'close'; token?: string }
export interface LifecycleBridge {
  listen(listener: (event: LifecycleEvent) => void): () => void
  arm(): Promise<void>
  finishClose(token: string): Promise<void>
  cancelClose(token: string): Promise<void>
}
