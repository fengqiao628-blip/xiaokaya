export interface LocalVoice {
  id: string
  name: string
  language: string
}
export interface SpeechRequest {
  text: string
  voiceId: string
  rate: number
  key: string
}
export interface SpeechBridge {
  claimStartupGreeting(): Promise<boolean>
  canPlay?(): Promise<boolean>
  onCancel?(listener: () => void): () => void
  voices(): Promise<LocalVoice[]>
  configure(input: { enabled: boolean; volume: number }): Promise<void>
  speak(input: SpeechRequest): Promise<{ started: boolean; message?: string }>
  stop(): Promise<void>
}
