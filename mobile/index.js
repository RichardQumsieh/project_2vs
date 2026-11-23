const quickCrypto = require("react-native-quick-crypto");
quickCrypto.install();

const base64 = require("base-64");
if (typeof global.atob !== "function") global.atob = base64.decode;
if (typeof global.btoa !== "function") global.btoa = base64.encode;

require("fast-text-encoding");

require("expo").registerRootComponent(require("./App").default);
