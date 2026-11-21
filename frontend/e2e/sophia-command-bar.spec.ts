import { existsSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const artifactDir = "/opt/cursor/artifacts";

const locales = [
  {
    id: "en" as const,
    command: "Rename the family chat to Sunday",
    label: "Tell Sophia what to do",
    run: "Run",
    undo: "Undo",
    undone: "Undone",
    stop: "Stop",
    renamed: /Renamed the group to Sunday/,
  },
  {
    id: "ar" as const,
    command: "سمِّ المجموعة إلى الأحد",
    label: "قولي لصوفيا ماذا تفعل",
    run: "تشغيل",
    undo: "تراجع",
    undone: "تم التراجع",
    stop: "إيقاف",
    renamed: /الأحد/,
  },
];

async function openPreview(page: Page, locale: "en" | "ar") {
  await page.addInitScript((value) => {
    localStorage.setItem("sophia-locale", value);
  }, locale);
  await page.goto(`/preview/mobile?surface=inbox&hub=assistant&lang=${locale}`);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

for (const locale of locales) {
  test(`sophia command bar runs, undoes, and stops in ${locale.id}`, async ({ page }, testInfo) => {
    await openPreview(page, locale.id);
    const bar = page.getByRole("form", { name: locale.id === "ar" ? "صوفيا" : "Sophia" });
    await expect(bar).toBeVisible();
    await bar.getByRole("textbox", { name: locale.label }).fill(locale.command);
    await bar.getByRole("button", { name: locale.run }).click();
    await expect(bar.getByText(locale.renamed)).toBeVisible();
    const undo = bar.getByRole("button", { name: locale.undo });
    await expect(undo).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    if (existsSync(artifactDir)) {
      mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({
        path: `${artifactDir}/sophia-command-${locale.id}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: testInfo.outputPath(`sophia-command-${locale.id}-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }

    await undo.click();
    await expect(bar.getByText(locale.undone)).toBeVisible();
    await bar.getByRole("button", { name: locale.stop }).click();
    await expect(bar.getByRole("status").filter({ hasText: /stopped|إيقاف/ })).toBeVisible();
  });
}
