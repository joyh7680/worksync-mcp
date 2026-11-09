import { resolve } from 'node:path';
import {
  LocalIdentityProvider,
  loadSettings,
  projectRoot,
  loadEnvironment,
} from './config/settings.js';
import { MockNotion, demoSettings } from './notion/mock.js';
import { NotionClient } from './notion/client.js';
import { Store } from './services/store.js';
import { WorklogService } from './services/worklog.js';
export function createApplication(demo = false) {
  loadEnvironment();
  const s = demo
    ? demoSettings(process.env.WORKSYNC_DEMO_STATE ?? resolve(projectRoot, '.worksync/demo'))
    : loadSettings();
  // Missing credentials never silently switch live requests to mock data.
  const api = demo ? new MockNotion(s) : new NotionClient(process.env.NOTION_TOKEN ?? '');
  const store = new Store(s.stateDirectory);
  const service = new WorklogService(
    new LocalIdentityProvider(s),
    api,
    store,
    !demo && process.env.WORKSYNC_ALLOW_WRITE === 'true',
    demo ? 'mock' : 'live',
  );
  return { s, api, store, service };
}
