require("react-native-gesture-handler");

if (typeof Array.prototype.at !== "function") {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value(index) {
      const length = this.length >>> 0;
      const integer = Math.trunc(Number(index)) || 0;
      const position = integer < 0 ? length + integer : integer;
      return position < 0 || position >= length ? undefined : this[position];
    },
  });
}

const quickCrypto = require("react-native-quick-crypto");
quickCrypto.install();

const base64 = require("base-64");
if (typeof global.atob !== "function") global.atob = base64.decode;
if (typeof global.btoa !== "function") global.btoa = base64.encode;

require("fast-text-encoding");
require("./src/notification-task");

require("expo").registerRootComponent(require("./App").default);
