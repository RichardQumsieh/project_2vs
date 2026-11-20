import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const locales = [
  {
    id: "en" as const,
    title: "Daily brief",
    meetings: "Today's meetings",
    replies: "Emails needing a reply",
    overdue: "Overdue follow-ups",
    actions: "Suggested actions",
    approve: "Approve draft",
    saved: "Saved.",
    preview: "Preview only. Nothing was sent or changed.",
    meeting: "Board review",
  },
  {
    id: "ar" as const,
    title: "الموجز اليومي",
    meetings: "اجتماعات اليوم",
    replies: "إيميلات بدها رد",
    overdue: "متابعات متأخرة",
    actions: "اقتراحات",
    approve: "الموافقة على المسودة",
    saved: "تم الحفظ.",
    preview: "معاينة فقط. ما انبعت ولا تغيّر شي.",
    meeting: "مراجعة البورد",
  },
];

test.beforeAll(() => {
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
});

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
  test(`daily brief is usable on a phone in ${locale.id}`, async ({ page }, testInfo) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/integrations/writes")) {
        writes.push(request.url());
      }
    });

    await openLocale(page, "/preview/brief", locale.id);
    await expect(page.getByRole("heading", { name: locale.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.meetings })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.replies })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.overdue })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.actions })).toBeVisible();
    await expect(page.getByText(locale.meeting).first()).toBeVisible();
    await expect(page.getByText("lina@acme.com").first()).toBeVisible();
    await expect(page.locator("text=lina@acme.com").first()).toHaveAttribute("dir", "ltr");

    const time = page.locator("input[type='time']");
    await time.fill("08:30");
    await page.getByRole("button", { name: locale.id === "ar" ? "حفظ الوقت" : "Save time" }).click();
    await expect(time).toHaveValue("08:30");
    await expect(page.getByText(locale.saved)).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/daily-brief-${locale.id}-${testInfo.project.name}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: locale.approve }).click();
    await expect(page.getByText(locale.preview)).toBeVisible();
    expect(writes).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });

  test(`an empty inbox asks to connect mail in ${locale.id}`, async ({ page }) => {
    await openLocale(page, "/preview/brief?disconnected=1", locale.id);
    const title = locale.id === "ar" ? "وصّل البريد والتقويم" : "Connect mail and calendar";
    const link = locale.id === "ar" ? "فتح الربط" : "Open integrations";
    await expect(page.getByRole("region", { name: title })).toBeVisible();
    await expect(page.getByRole("link", { name: link })).toHaveAttribute("href", "/settings/integrations");
    await expect(page.getByText(locale.id === "ar" ? "ما قدرنا نحمّل الموجز." : "The brief could not be loaded.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: locale.meetings })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
}

test("the signed-in brief route asks for login when the session is missing", async ({ page }) => {
  await openLocale(page, "/inbox/brief", "en");
  await expect(page.getByRole("heading", { name: "Daily brief" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
