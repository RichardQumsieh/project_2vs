import { expect, test, type Page } from "@playwright/test";

const workspace = {
  id: "ws-1",
  name: "Haddad",
  kind: "FAMILY",
  planId: "FREE_FAMILY",
  role: "OWNER",
  seatCount: 2,
  seatLimit: 6,
  dailyBrief: false,
  billingStatus: "comped",
  billingEnabled: false,
};

const detail = {
  workspace,
  members: [
    {
      userId: "user-1",
      username: "lina",
      displayName: "لينا حداد",
      role: "OWNER",
      joinedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      userId: "user-2",
      username: "omar",
      displayName: "Omar Haddad",
      role: "MEMBER",
      joinedAt: "2026-06-02T00:00:00.000Z",
    },
  ],
  invites: [
    {
      id: "inv-1",
      hint: "7KQM",
      expiresAt: "2026-06-20T00:00:00.000Z",
      consumedAt: null,
      revokedAt: null,
      createdAt: "2026-06-03T00:00:00.000Z",
    },
  ],
};

async function openLocale(page: Page, path: string, locale: "en" | "ar") {
  await page.addInitScript((value) => {
    localStorage.setItem("sophia-locale", value);
    // The app service worker claims the page and re-fetches GETs. Those
    // fetches skip Playwright's route mock, so keep registration off here.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  }, locale);
  const joiner = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${joiner}lang=${locale}`);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mockWorkspaceApi(page: Page) {
  await page.route(/https?:\/\/(localhost|127\.0\.0\.1):3001\/.*/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/workspaces" && method === "GET") return json({ workspaces: [workspace] });
    if (url.pathname === "/workspaces/ws-1" && method === "GET") return json(detail);
    if (url.pathname === "/workspaces/ws-1/invites" && method === "POST") {
      return json({
        invite: {
          id: "inv-2",
          code: "ABCD23456789",
          hint: "6789",
          expiresAt: "2026-06-21T00:00:00.000Z",
          path: "/join?code=ABCD23456789",
        },
      }, 201);
    }
    if (url.pathname === "/workspace-invites/preview") {
      return json({ workspace: { name: "Haddad", kind: "FAMILY" } });
    }
    if (url.pathname === "/waitlist" && method === "POST") return json({ ok: true }, 201);
    return json({ error: "unauthorized" }, 401);
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`pricing explains privacy and plans in ${locale}`, async ({ page }, testInfo) => {
    await mockWorkspaceApi(page);
    await openLocale(page, "/pricing", locale);
    await expect(page.getByRole("heading", { name: locale === "ar" ? "خطط للعائلات والفرق" : "Plans for families and teams" })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "ar" ? "أرقام الأمان" : "Safety numbers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "ar" ? "عائلة مجانية" : "Free Family" })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "ar" ? "فريق" : "Team", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "ar" ? "الانضمام إلى القائمة" : "Join the list" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/pricing-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test(`admin console lists members, seats, and invites in ${locale}`, async ({ page }, testInfo) => {
    await mockWorkspaceApi(page);
    await openLocale(page, "/settings/workspace", locale);
    await expect(page.getByRole("heading", { name: locale === "ar" ? "مساحة العمل" : "Workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Haddad" })).toBeVisible();
    await expect(page.getByText(/2/).first()).toBeVisible();
    await expect(page.getByText("@omar")).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "ar" ? "إنشاء رابط دعوة" : "Create invite link" })).toBeVisible();
    await page.getByRole("button", { name: locale === "ar" ? "إنشاء رابط دعوة" : "Create invite link" }).click();
    await expect(page.getByText("ABCD23456789", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/admin-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test(`invite redemption previews the workspace in ${locale}`, async ({ page }, testInfo) => {
    await mockWorkspaceApi(page);
    await openLocale(page, "/join?code=ABCD23456789", locale);
    await expect(page.getByRole("heading", { name: locale === "ar" ? "الانضمام إلى مساحة" : "Join a workspace" })).toBeVisible();
    await expect(page.getByText(/Haddad/)).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "ar" ? "الانضمام إلى المساحة" : "Join workspace" })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/invite-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
}
