const fs = require("fs");
const path = require("path");
const { AndroidConfig, createRunOncePlugin, withStringsXml } = require("@expo/config-plugins");

/** Copy the English Android strings into values/strings.xml so localized copies are not ExtraTranslation. */
function withDefaultLocaleStrings(config) {
  return withStringsXml(config, (next) => {
    const locale = next.locales?.en;
    if (typeof locale !== "string" || locale.length === 0) return next;
    const file = path.isAbsolute(locale) ? locale : path.join(next.modRequest.projectRoot, locale);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const android = parsed && typeof parsed.android === "object" ? parsed.android : null;
    if (!android) return next;
    const items = Object.entries(android)
      .filter((entry) => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([name, value]) => ({ $: { name }, _: value }));
    if (items.length === 0) return next;
    next.modResults = AndroidConfig.Strings.setStringItem(items, next.modResults);
    return next;
  });
}

module.exports = createRunOncePlugin(withDefaultLocaleStrings, "sophia-default-locale-strings");
