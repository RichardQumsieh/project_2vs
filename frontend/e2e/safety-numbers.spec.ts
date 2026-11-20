import { expect, test, type Page } from "@playwright/test";

const locales = [
  {
    id: "en" as const,
    title: "Safety numbers",
    warning: "Safety number changed",
    verify: "Mark as verified",
    verified: "Verified",
    group: "Leadership",
    peer: "Sara Haddad",
    signIn: "Sign in to compare safety numbers for your chats.",
    security: "Security",
  },
  {
    id: "ar" as const,
    title: "أرقام الأمان",
    warning: "تغيّر رقم الأمان",
    verify: "تعليم أنه تم التحقق",
    verified: "تم التحقق",
    group: "القيادة",
    peer: "سارة حداد",
    signIn: "سجّل الدخول لمقارنة أرقام الأمان لمحادثاتك.",
    security: "الأمان",
  },
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
  test(`safety numbers warn and can be marked verified in ${locale.id}`, async ({ page }, testInfo) => {
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await openLocale(page, "/preview/safety", locale.id);
    const warning = page.getByRole("alert").filter({ hasText: locale.warning });
    await expect(page.getByRole("heading", { name: locale.title, exact: true }).first()).toBeVisible();
    await expect(warning).toBeVisible();
    await expect(page.getByText(locale.peer).first()).toBeVisible();
    await expect(page.getByText("48291")).toBeVisible();
    await expect(page.getByRole("img", { name: locale.id === "ar" ? "رمز QR لرقم الأمان" : "Safety number QR code" })).toBeVisible();
    await expect(page.getByText("@sara").first()).toBeVisible();
    await expect(page.getByRole("button", { name: locale.group })).toBeVisible();
    const number = page.locator("[dir='ltr']").filter({ hasText: "48291" });
    await expect(number.first()).toHaveAttribute("dir", "ltr");
    await expectNoHorizontalOverflow(page);
    if (testInfo.project.name === "iphone") {
      await page.screenshot({
        path: `/opt/cursor/artifacts/safety-${locale.id}-iphone.png`,
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: locale.verify }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.getByText(locale.verified, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: locale.verify })).toBeDisabled();

    await page.getByRole("button", { name: locale.group }).click();
    await expect(page.getByRole("heading", { name: locale.group })).toBeVisible();
    await expect(page.getByText("11028")).toBeVisible();
    await page.getByRole("button", { name: locale.verify }).click();
    await expect(page.getByText(locale.verified, { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(posts).toEqual([]);
  });

  test(`security settings keep safety numbers behind sign-in in ${locale.id}`, async ({ page }) => {
    await openLocale(page, "/settings/security", locale.id);
    await expect(page.getByRole("heading", { name: locale.security, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.title, exact: true })).toBeVisible();
    await expect(page.getByText(locale.signIn)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
