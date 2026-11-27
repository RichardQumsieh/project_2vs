import { extractLinks, maxLinksPerMessage } from "../../frontend/lib/url-links";
import { api } from "./api";

/** Client-side link gate using the same extractors as web; reputation via mobile API. */
export async function assertOutgoingLinksSafe(text: string) {
  const links = extractLinks(text);
  if (links.length > maxLinksPerMessage) {
    throw new Error(`Messages can contain at most ${maxLinksPerMessage} links so each can be checked.`);
  }
  const invalid = links.find((link) => link.issue || !link.url);
  if (invalid) {
    throw new Error(invalid.issue ?? "This URL could not be verified safely.");
  }
  if (links.length === 0) return;

  const { results } = await api.checkUrlSafety(links.map((link) => link.url!));
  const byUrl = new Map(results.map((result) => [result.url, result]));
  const ordered = links.map((link) => byUrl.get(link.url!) ?? { status: "unavailable" as const });
  if (ordered.some((result) => result.status === "threat")) {
    throw new Error(
      "Sending blocked: a link is reported for malware or phishing. Remove it and verify with the recipient another way.",
    );
  }
  if (ordered.some((result) => result.status !== "clean")) {
    throw new Error(
      "Sending blocked: one or more links could not be verified. Try again later or remove the link.",
    );
  }
}
