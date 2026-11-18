import type { SnapshotPurpose } from './backup'
export type DataCsvKind =
  | 'tasks'
  | 'sessions'
  | 'cycles'
  | 'materials'
  | 'chapters'
  | 'weekly-plans'
  | 'weekly-targets'
  | 'schedule-history'
  | 'exam-dates'
  | 'focus-timers'
export type CsvKind = DataCsvKind | 'statistics'
export interface SavedFile {
  path: string
  savedAt: string
  warning?: string
}
export interface SnapshotInfo {
  id: string
  fileName: string
  createdAt: string
  purpose: SnapshotPurpose
  schemaVersion: number
  datasetId: string
  bytes: number
  counts: Record<string, number>
}
export interface SnapshotListing {
  snapshots: SnapshotInfo[]
  problems: string[]
}
export interface RecoveryJournal {
  operationId: string
  kind: 'restore' | 'migration'
  status: 'prepared' | 'committed' | 'rolled-back'
  snapshotId: string
  targetFingerprint: string
  beforeFingerprint: string
  startedAt: string
  finishedAt?: string
  message?: string
}
export interface BackupStatus {
  lastExport: SavedFile | null
  journal: RecoveryJournal | null
}
export interface BackupBridge {
  chooseBackupFile(): Promise<{ name: string; content: string } | null>
  exportBackup(content: string): Promise<SavedFile | null>
  exportCsv(content: string, kind: CsvKind): Promise<SavedFile | null>
  saveSnapshot(content: string): Promise<SnapshotInfo>
  listSnapshots(): Promise<SnapshotListing>
  readSnapshot(id: string): Promise<string>
  status(): Promise<BackupStatus>
  writeJournal(journal: RecoveryJournal): Promise<void>
  openBackupFolder(): Promise<void>
}
