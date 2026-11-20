import { expect, test, type Page } from "@playwright/test";

const locales = [
  {
    id: "en" as const,
    title: "Adaptive appearance",
    proposal: "Want a calmer evening theme?",
    preview: "Preview",
    approve: "Approve",
    undo: "Undo",
    reset: "Reset to default",
    arabic: "Arabic",
    remove: "Remove image",
    card: "Adaptive appearance",
    sample: /Proposed timing: Wednesday/,
    arabicSample: /فينا نجتمع/,
  },
  {
    id: "ar" as const,
    title: "المظهر المتكيّف",
    proposal: "بدك مظهر مسائي أهدأ؟",
    preview: "معاينة",
    approve: "موافقة",
    undo: "تراجع",
    reset: "إعادة الضبط",
    arabic: "العربية",
    remove: "إزالة الصورة",
    card: "المظهر المتكيّف",
    sample: /Proposed timing: Wednesday/,
    arabicSample: /فينا نجتمع/,
  },
];

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
  test(`adaptive appearance proposes, previews, and undoes in ${locale.id}`, async ({ page }, testInfo) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.startsWith("blob:") ||
        url.startsWith("data:") ||
        url.includes("127.0.0.1") ||
        url.includes("localhost")
      ) {
        return;
      }
      external.push(url);
    });

    await openLocale(page, "/preview/appearance?hour=21&role=manager", locale.id);
    await expect(page.getByRole("heading", { name: locale.title })).toBeVisible();
    await expect(page.getByRole("article", { name: locale.id === "ar" ? "اقتراح صوفيا" : "Sophia suggestion" })).toBeVisible();
    await expect(page.getByText(locale.proposal)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`proposal-${locale.id}.png`),
      fullPage: true,
    });

    await expect(page.getByRole("button", { name: locale.undo })).toBeDisabled();
    await page.getByRole("button", { name: locale.preview }).click();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "on");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText(locale.id === "ar" ? "المعاينة شغّالة. وافق لتثبيتها، أو ألغِها." : "Preview is on. Approve to keep it, or cancel.")).toBeVisible();
    await page.getByRole("button", { name: locale.approve }).click();
    await expect(page.getByRole("button", { name: locale.undo })).toBeEnabled();
    await page.getByRole("button", { name: locale.undo }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-appearance", "on");

    await page.getByRole("group", { name: locale.id === "ar" ? "لغة المسودة" : "Draft language" }).getByRole("button", { name: locale.arabic }).click();
    await expect(page.getByText(locale.arabicSample)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`draft-${locale.id}.png`),
      fullPage: true,
    });

    await page.locator('input[type="file"]').setInputFiles({
      name: "local.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByRole("button", { name: locale.remove })).toBeVisible();
    await page.locator("#appearance-accent").fill("#888888");
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.getByRole("button", { name: locale.reset }).click();
    await expect(page.getByText(locale.sample)).toBeVisible();
    expect(external).toEqual([]);

    await openLocale(page, "/settings", locale.id);
    await page.getByRole("link", { name: new RegExp(locale.card) }).click();
    await expect(page.getByRole("heading", { name: locale.title })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
