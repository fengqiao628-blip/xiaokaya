import { resolve, join } from 'node:path'
import { USER_DATA_FOLDER } from '../shared/identity'

export function storagePaths(
  appData: string,
  projectRoot: string,
  packaged: boolean,
  testName?: string,
) {
  // A packaged app never accepts an environment override for its production profile.
  if (!packaged && testName && !/^[a-zA-Z0-9_-]{1,80}$/.test(testName))
    throw new Error('Invalid test profile')
  const environment = packaged ? 'production' : testName ? 'test' : 'development'
  const userData = packaged
    ? join(appData, USER_DATA_FOLDER)
    : resolve(projectRoot, '.runtime', testName ? `e2e/${testName}` : 'dev')
  return { userData, sessionData: join(userData, 'profile'), environment } as const
}
