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
  billingStatus: "incomplete",
  billingEnabled: true,
  billingProvider: "paypal",
};

const approvalUrl = "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-TEST";

async function openLocale(page: Page, path: string, locale: "en" | "ar") {
  await page.addInitScript((value) => {
    localStorage.setItem("sophia-locale", value);
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

async function mockBillingApi(page: Page, confirm: { granted: boolean; status: string; planId: string | null }) {
  await page.route(/https?:\/\/(localhost|127\.0\.0\.1):3001\/.*/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/workspaces" && method === "GET") return json({ workspaces: [workspace] });
    if (url.pathname === "/workspaces/ws-1/billing/checkout" && method === "POST") {
      return json({ ok: true, status: "incomplete", checkoutUrl: approvalUrl });
    }
    if (url.pathname === "/workspaces/ws-1/billing/paypal/confirm" && method === "POST") {
      return json({ ok: true, ...confirm });
    }
    return json({ error: "unauthorized" }, 401);
  });
  await page.route("https://www.sandbox.paypal.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>PayPal</title><p>Sandbox approval</p>",
    });
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`owner can start a PayPal upgrade in ${locale}`, async ({ page }, testInfo) => {
    await mockBillingApi(page, { granted: true, status: "active", planId: "FAMILY_PLUS" });
    await openLocale(page, "/billing/upgrade", locale);
    await expect(page.getByRole("heading", { name: locale === "ar" ? "ترقية الخطة" : "Upgrade" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "ar" ? "عائلة مجانية" : "Free Family" })).toBeVisible();
    const button = page.getByRole("button", { name: locale === "ar" ? "المتابعة إلى باي بال" : "Continue to PayPal" });
    await expect(button).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/paypal-upgrade-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const checkout = page.waitForRequest((request) => request.url().includes("/billing/checkout") && request.method() === "POST");
    await button.click();
    const request = await checkout;
    expect(request.postDataJSON()).toMatchObject({ planId: "FAMILY_PLUS" });
    await expect(page).toHaveURL(/sandbox\.paypal\.com/);
  });

  test(`return page waits for PayPal confirmation in ${locale}`, async ({ page }, testInfo) => {
    await mockBillingApi(page, { granted: true, status: "active", planId: "FAMILY_PLUS" });
    await openLocale(
      page,
      "/billing/paypal/return?workspace=ws-1&subscription_id=I-TEST&status=ACTIVE",
      locale,
    );
    const confirmed = locale === "ar" ? /أكد باي بال الاشتراك/ : /PayPal confirmed the subscription/;
    await expect(page.getByText(confirmed)).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "صفحة العودة ليست إثباتًا للدفع." : "This page is not proof of payment.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/opt/cursor/artifacts/paypal-return-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test(`return page does not grant a plan from the query string in ${locale}`, async ({ page }) => {
    await mockBillingApi(page, { granted: false, status: "incomplete", planId: null });
    await openLocale(
      page,
      "/billing/paypal/return?workspace=ws-1&subscription_id=I-TEST&status=ACTIVE",
      locale,
    );
    await expect(page.getByText(locale === "ar" ? "لم يفعّل باي بال الاشتراك بعد" : "PayPal has not activated this subscription yet")).toBeVisible();
    await expect(page.getByText(locale === "ar" ? /أكد باي بال الاشتراك/ : /PayPal confirmed the subscription/)).toHaveCount(0);
  });

  test(`cancel page does not confirm a subscription in ${locale}`, async ({ page }) => {
    let confirms = 0;
    await mockBillingApi(page, { granted: true, status: "active", planId: "FAMILY_PLUS" });
    page.on("request", (request) => {
      if (request.url().includes("/billing/paypal/confirm")) confirms += 1;
    });
    await openLocale(page, "/billing/paypal/cancel?workspace=ws-1", locale);
    await expect(page.getByRole("heading", { name: locale === "ar" ? "أُلغي الدفع" : "Checkout cancelled" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: locale === "ar" ? "العودة إلى الترقية" : "Back to upgrade" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(confirms).toBe(0);
  });
}
