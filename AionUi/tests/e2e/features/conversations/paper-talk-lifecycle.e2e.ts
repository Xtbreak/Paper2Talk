import fs from 'node:fs/promises';
import { readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page, Request, Response, TestInfo } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { httpInvoke } from '../../helpers/httpBridge';
import {
  clearMonitorEvents,
  installMonitorRecorder,
  monitorRecorderStatus,
  readMonitorEvents,
} from '../../helpers/monitorEvents';

// These tests must never attach to the developer's profile or a running app.
const configuredProfile = process.env.AIONUI_E2E_USER_DATA_DIR;
if (configuredProfile !== undefined) {
  throw new Error('PaperTalk E2E refuses custom userData; let the fixture create a new disposable directory');
}

function homeAliasTargets() {
  return Object.fromEntries(
    ['.paper2talk-dev', '.paper2talk-config-dev'].map((name) => {
      try {
        return [name, readlinkSync(path.join(os.homedir(), name))];
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EINVAL') return [name, code];
        throw error;
      }
    })
  );
}

// Capture before the Electron fixture launches. Only link metadata is read.
const initialHomeAliases = homeAliasTargets();

type ReportFixture = { id: string; workspace: string; conversation: string; title: string };
type HistoryRow = { id: string; conversation: string | null };
const labels = {
  active: /^(Recent chats|最近对话|对话历史)$/,
  archived: /^(Archived|已归档|归档)$/,
  archive: /^(Archive|归档)$/,
  restore: /^(Unarchive|Restore|恢复|取消归档)$/,
  delete: /^(Delete|删除)$/,
  cancel: /^(Cancel|取消)$/,
};
let sandbox = '';
let requests: { method: string; path: string; status: number }[] = [];
let removeListeners: (() => void)[] = [];

async function api<T>(page: Page, method: 'GET' | 'POST' | 'DELETE', route: string, body?: unknown) {
  return httpInvoke<T>(page, method, route, body);
}

async function status(page: Page, route: string) {
  return page.evaluate(async (requestPath) => {
    const port = (window as unknown as { __backendPort: number }).__backendPort;
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
    return { status: response.status, body: await response.json() };
  }, route);
}

async function history(page: Page, archived = false) {
  return api<HistoryRow[]>(page, 'GET', '/api/paper-talk' + (archived ? '?archived=true' : ''));
}

async function seed(page: Page, title: string): Promise<ReportFixture> {
  const report = await api<{ id: string; workspace: string }>(page, 'POST', '/api/paper-talk', {
    direction: title,
    intent: 'Compare test methods',
    count: 3,
    minutes: 10,
    months: 12,
    region: 'international',
    strict_quartile: true,
    style: 'international',
    inputs: [],
  });
  // Validate the actual backend data root before writing any fixture file.
  expect(path.resolve(report.workspace).startsWith(path.resolve(sandbox) + path.sep)).toBe(true);
  const conversation = await api<{ id: string }>(page, 'POST', '/api/conversations', {
    type: 'acp',
    name: title,
    extra: { backend: 'codex', workspace: report.workspace, paper_talk_report_id: report.id },
  });
  await api(page, 'POST', `/api/paper-talk/${report.id}/conversation`, { conversation: conversation.id });
  await expectChangedFrame(page, conversation.id, 'created');
  return { ...report, title, conversation: conversation.id };
}

async function showHistory(page: Page, archived = false) {
  await page.evaluate(
    (view) => {
      window.location.hash = '/paper-talk?history=' + view;
    },
    archived ? 'archived' : 'active'
  );
  await expect(page.getByRole('navigation', { name: archived ? labels.archived : labels.active })).toBeVisible();
}

async function menu(page: Page, report: ReportFixture, action: RegExp) {
  await page.locator(`#report-actions-${report.id}`).click();
  await page.getByRole('menuitem', { name: action }).click();
}

async function capture(page: Page, info: TestInfo, name: string) {
  const screenshot = info.outputPath(name + '.png');
  const events = info.outputPath(name + '-backend-events.json');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await fs.writeFile(events, JSON.stringify(await readMonitorEvents(page), null, 2));
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  await info.attach(name + '-backend-events', { path: events, contentType: 'application/json' });
}

async function expectChangedFrame(page: Page, conversation: string, action: 'created' | 'updated' | 'deleted') {
  await expect
    .poll(
      async () => {
        const events = await readMonitorEvents(page, 'conversation.listChanged');
        return events.some((event) => {
          const data = event.data as { conversation_id?: string; action?: string };
          return data.conversation_id === conversation && data.action === action;
        });
      },
      { message: `Real backend WebSocket change for ${conversation}`, timeout: 10_000 }
    )
    .toBe(true);
}

test.describe('PaperTalk lifecycle against an isolated real backend', () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page, electronApp }) => {
    expect(homeAliasTargets(), 'Launching E2E must not retarget the real profile aliases').toEqual(initialHomeAliases);
    requests = [];
    removeListeners = [];
    const recordResponse = (response: Response) => {
      const route = new URL(response.url()).pathname;
      if (/^\/api\/(paper-talk|conversations|sidebar)(\/|$)/.test(route)) {
        requests.push({ method: response.request().method(), path: route, status: response.status() });
      }
    };
    page.on('response', recordResponse);
    removeListeners.push(() => page.off('response', recordResponse));
    sandbox = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(path.resolve(sandbox).startsWith(path.join(os.tmpdir(), 'aionui-e2e-'))).toBe(true);
    sandbox = await fs.realpath(sandbox);
    await installMonitorRecorder(page);
    await expect.poll(() => monitorRecorderStatus(page)).toBe('open');
  });

  test.afterEach(async ({ page }, info) => {
    for (const remove of removeListeners) remove();
    if (!page.isClosed()) await capture(page, info, 'final-state');
    const statuses = info.outputPath('lifecycle-http-statuses.json');
    await fs.writeFile(statuses, JSON.stringify(requests, null, 2));
    await info.attach('lifecycle-http-statuses', { path: statuses, contentType: 'application/json' });
    const aliases = homeAliasTargets();
    const isolation = info.outputPath('profile-isolation.json');
    await fs.writeFile(isolation, JSON.stringify({ sandbox, before: initialHomeAliases, after: aliases }, null, 2));
    await info.attach('profile-isolation', { path: isolation, contentType: 'application/json' });
    expect(aliases, 'E2E must leave both real profile aliases untouched').toEqual(initialHomeAliases);
  });

  test('report menu archive and restore move the linked ordinary conversation', async ({ page }, info) => {
    const report = await seed(page, 'E2E UI archive and restore');
    await showHistory(page);
    await expect(page.getByRole('button', { name: report.title, exact: true })).toBeVisible();
    await menu(page, report, labels.archive);
    await expect(page.getByRole('button', { name: report.title, exact: true })).toHaveCount(0);
    const archivedSidebar = await api(page, 'GET', '/api/sidebar?archived=true');
    expect(JSON.stringify(archivedSidebar)).toContain(report.conversation);
    expect((await status(page, `/api/paper-talk/${report.id}`)).status).toBe(410);
    await showHistory(page, true);
    await menu(page, report, labels.restore);
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect(JSON.stringify(await api(page, 'GET', '/api/sidebar'))).toContain(report.conversation);
    expect((await history(page)).some((row) => row.id === report.id)).toBe(true);
    await capture(page, info, 'restored-ordinary-chat');
  });

  test('cancel keeps both records; confirming report deletion keeps generated files and invalidates the old link', async ({
    page,
  }, info) => {
    const report = await seed(page, 'E2E delete confirmation');
    const artifact = path.join(report.workspace, 'retained-export.pptx');
    await fs.writeFile(artifact, 'E2E generated artifact');
    await showHistory(page);
    await menu(page, report, labels.delete);
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(report.title);
    await dialog.getByRole('button', { name: labels.cancel }).click();
    await expect(dialog).toBeHidden();
    expect((await status(page, `/api/conversations/${report.conversation}`)).status).toBe(200);
    expect((await status(page, `/api/paper-talk/${report.id}`)).status).toBe(200);
    await menu(page, report, labels.delete);
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.delete }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect((await status(page, `/api/conversations/${report.conversation}`)).status).toBe(404);
    expect((await status(page, `/api/paper-talk/${report.id}`)).status).toBe(404);
    expect(await fs.readFile(artifact, 'utf8')).toBe('E2E generated artifact');
    const creations: string[] = [];
    const recordCreation = (request: Request) => {
      if (request.method() === 'POST' && /\/api\/(conversations|paper-talk)$/.test(request.url()))
        creations.push(request.url());
    };
    page.on('request', recordCreation);
    removeListeners.push(() => page.off('request', recordCreation));
    await page.evaluate((id) => {
      window.location.hash = '/paper-talk?report=' + id;
    }, report.id);
    await expect(page.getByText(/no longer available|已删除|不存在|无法找到|无法打开/).first()).toBeVisible();
    expect(creations).toEqual([]);
    await capture(page, info, 'deleted-old-link');
  });

  test('ordinary conversation deletion refreshes report history through a real WebSocket event', async ({
    page,
  }, info) => {
    const report = await seed(page, 'E2E ordinary delete signal');
    await showHistory(page);
    await expect(page.getByRole('button', { name: report.title, exact: true })).toBeVisible();
    await clearMonitorEvents(page);
    const route = page.url();
    await api(page, 'DELETE', `/api/conversations/${report.conversation}`);
    await expectChangedFrame(page, report.conversation, 'deleted');
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect(page.url()).toBe(route);
    expect((await status(page, `/api/paper-talk/${report.id}`)).status).toBe(404);
    await capture(page, info, 'ordinary-delete-websocket');
  });

  test('ordinary archive refreshes active report history without navigation or synthetic events', async ({
    page,
  }, info) => {
    const report = await seed(page, 'E2E ordinary archive signal');
    await showHistory(page);
    await expect(page.getByRole('button', { name: report.title, exact: true })).toBeVisible();
    await clearMonitorEvents(page);
    const route = page.url();
    await api(page, 'POST', `/api/sidebar/conversation/${report.conversation}/archive`);
    expect((await history(page, true)).some((row) => row.id === report.id)).toBe(true);
    await expectChangedFrame(page, report.conversation, 'updated');
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect(page.url()).toBe(route);
    await capture(page, info, 'ordinary-archive-websocket');
  });

  test('ordinary restore refreshes archived report history without navigation or synthetic events', async ({
    page,
  }, info) => {
    const report = await seed(page, 'E2E ordinary restore signal');
    await api(page, 'POST', `/api/paper-talk/${report.id}/archive`);
    await expectChangedFrame(page, report.conversation, 'updated');
    await showHistory(page, true);
    await expect(page.locator(`#report-actions-${report.id}`)).toBeVisible();
    await clearMonitorEvents(page);
    const route = page.url();
    await api(page, 'POST', `/api/sidebar/conversation/${report.conversation}/unarchive`);
    expect((await history(page)).some((row) => row.id === report.id)).toBe(true);
    await expectChangedFrame(page, report.conversation, 'updated');
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect(page.url()).toBe(route);
    await capture(page, info, 'ordinary-restore-websocket');
  });

  test('ordinary archive bulk deletion removes the corresponding archived report rows', async ({ page }, info) => {
    const report = await seed(page, 'E2E ordinary archive bulk delete');
    await api(page, 'POST', `/api/paper-talk/${report.id}/archive`);
    await expectChangedFrame(page, report.conversation, 'updated');
    await showHistory(page, true);
    await expect(page.locator(`#report-actions-${report.id}`)).toBeVisible();
    await clearMonitorEvents(page);
    await api(page, 'DELETE', '/api/sidebar/archived');
    await expectChangedFrame(page, report.conversation, 'deleted');
    await expect(page.locator(`#report-actions-${report.id}`)).toHaveCount(0);
    expect((await status(page, `/api/paper-talk/${report.id}`)).status).toBe(404);
    await capture(page, info, 'ordinary-bulk-delete-websocket');
  });
});
