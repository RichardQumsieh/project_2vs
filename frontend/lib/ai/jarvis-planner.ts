/** @deprecated Compatibility aliases — prefer sophia-planner. */
export {
  parseSophiaCommand as parseJarvisCommand,
  stripSophiaWakeWord as stripJarvisWakeWord,
  isSophiaAddressed as isJarvisAddressed,
  resolveRelativeDate,
  type SophiaIntent as JarvisIntent,
  type SophiaPlan as JarvisPlan,
} from "./sophia-planner";
