// Opens the built page in headless Chromium with the API faked, and nothing
// else reachable (test-tiers.md).
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { afterAll, afterEach, inject } from "vitest";

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export interface ApiAnswer {
  status: number;
  body?: unknown;
}

export type FakeApi = (call: ApiCall) => ApiAnswer;

let browser: Browser | undefined;
const contexts: BrowserContext[] = [];

// A page left open from one test would go on polling during the next.
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

afterAll(async () => {
  await browser?.close();
  browser = undefined;
});

export async function openPage(
  path: string,
  api: FakeApi,
): Promise<{ page: Page; calls: ApiCall[] }> {
  browser ??= await chromium.launch();
  const pageUrl = inject("pageUrl");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const calls: ApiCall[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== pageUrl) {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const text = request.postData();
    const call: ApiCall = {
      method: request.method(),
      path: url.pathname,
      body: text === null ? undefined : (JSON.parse(text) as unknown),
    };
    calls.push(call);
    const answer = api(call);
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: answer.body === undefined ? "" : JSON.stringify(answer.body),
    });
  });
  const page = await context.newPage();
  await page.goto(`${pageUrl}${path}`);
  return { page, calls };
}
