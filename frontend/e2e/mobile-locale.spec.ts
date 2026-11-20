import { expect, test, type Page } from "@playwright/test";

const locales = [
  { id: "en" as const, dir: "ltr", signup: "Create your account.", settings: "Settings" },
  { id: "ar" as const, dir: "rtl", signup: "أنشئ حسابك.", settings: "الإعدادات" },
];

test.beforeEach(async ({ page }) => {
  await page.route(/https?:\/\/(localhost|127\.0\.0\.1):3001\/.*/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthorized" }),
    });
  });
});

async function openLocale(page: Page, path: string, locale: "en" | "ar") {
  await page.addInitScript((value) => {
    localStorage.setItem("sophia-locale", value);
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

for (const locale of locales) {
  test(`signup is usable at mobile width in ${locale.id}`, async ({ page }, testInfo) => {
    await openLocale(page, "/signup", locale.id);
    await expect(page.getByRole("heading", { name: locale.signup })).toBeVisible();
    await expect(page.getByRole("group", { name: locale.id === "ar" ? "اللغة" : "Language" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`signup-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
  });

  test(`login keeps email direction isolated in ${locale.id}`, async ({ page }, testInfo) => {
    await openLocale(page, "/login", locale.id);
    await expect(page.getByRole("heading", { name: locale.id === "ar" ? "البريد وكلمة السر." : "Email and password." })).toBeVisible();
    await expect(page.locator("#email")).toHaveAttribute("dir", "ltr");
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`login-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
  });

  test(`settings exposes language and experimental label in ${locale.id}`, async ({ page }, testInfo) => {
    await openLocale(page, "/settings", locale.id);
    await expect(page.getByRole("heading", { name: locale.settings, exact: true })).toBeVisible();
    await expect(page.getByText(locale.id === "ar" ? "تجريبي" : "Experimental").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`settings-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
  });

  test(`inbox, chat, and approvals render in ${locale.id}`, async ({ page }, testInfo) => {
    await openLocale(page, "/preview/mobile?surface=inbox", locale.id);
    await expect(page.getByRole("heading", { name: locale.id === "ar" ? "الوارد" : "Inbox" })).toBeVisible();
    await expect(page.getByText("سارة حداد").first()).toBeVisible();
    await expect(page.getByText("@sara").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`inbox-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }

    await openLocale(page, "/preview/mobile?surface=chat", locale.id);
    await expect(page.getByRole("heading", { name: "سارة حداد" })).toBeVisible();
    await expect(page.getByText(/Wednesday evening/)).toBeVisible();
    await expect(page.getByText(/البورد ديك/)).toBeVisible();
    const mine = page.locator(".thread-message").filter({ hasText: "sara@acme.com" });
    const position = await mine.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { start: rect.left, end: rect.right, width: document.documentElement.clientWidth };
    });
    if (locale.id === "ar") {
      expect(position.start).toBeLessThan(position.width / 2);
    } else {
      expect(position.end).toBeGreaterThan(position.width / 2);
    }
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`chat-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }

    await openLocale(page, "/preview/mobile?surface=approvals", locale.id);
    await expect(page.getByRole("article", { name: locale.id === "ar" ? "مراجعة إجراء صوفيا المجهّز" : "Review staged Sophia action" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: locale.id === "ar" ? "الموافقة على المسودة" : "Approve draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: locale.id === "ar" ? "الموافقة على الحدث" : "Approve event" })).toBeVisible();
    await expect(page.getByText("sara@acme.com").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (locale.id === "ar") {
      await page.screenshot({
        path: testInfo.outputPath(`approvals-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
  });
}

test("manifest and service worker are installable", async ({ page }) => {
  await openLocale(page, "/", "en");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const body = await manifest.json();
  expect(body.display).toBe("standalone");
  expect(body.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      return registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? "";
    });
  }).toContain("/sw.js");
});
