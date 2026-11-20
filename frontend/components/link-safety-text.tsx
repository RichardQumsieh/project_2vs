"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  checkUrlsWithReputation,
  extractLinks,
  maxLinksPerMessage,
  youtubeEmbedUrl,
  type UrlSafetyResult,
} from "@/lib/url-safety";

function openCheckedUrl(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    return;
  }
  if (
    url.protocol === "http:" &&
    !window.confirm(
      `This link is not encrypted in transit. Continue to ${url.hostname}?`,
    )
  ) {
    return;
  }
  window.open(url.href, "_blank", "noopener,noreferrer");
}

export function LinkSafetyText({ text }: { text: string }) {
  const links = useMemo(() => extractLinks(text), [text]);
  const reputationUrls = useMemo(
    () => [...new Set(links.flatMap((link) => link.url ? [link.url] : []))],
    [links],
  );
  const requestKey = reputationUrls.join("\n");
  const [checkState, setCheckState] = useState<{
    key: string;
    results: Map<string, UrlSafetyResult>;
    error: string | null;
  } | null>(null);
  const results = checkState?.key === requestKey ? checkState.results : new Map();
  const checkError = checkState?.key === requestKey ? checkState.error : null;
  const checking = reputationUrls.length > 0 &&
    links.length <= maxLinksPerMessage &&
    checkState?.key !== requestKey;

  useEffect(() => {
    let active = true;
    if (reputationUrls.length === 0 || links.length > maxLinksPerMessage) {
      return () => {
        active = false;
      };
    }

    void checkUrlsWithReputation(reputationUrls)
      .then((checked) => {
        if (active) {
          setCheckState({
            key: requestKey,
            results: new Map(checked.map((result) => [result.url, result])),
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCheckState({
            key: requestKey,
            results: new Map(),
            error: error instanceof Error
              ? error.message
              : "The links could not be checked.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [links.length, reputationUrls, requestKey]);

  if (links.length === 0) {
    return <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words">{text}</p>;
  }

  const messageParts: ReactNode[] = [];
  let offset = 0;
  links.forEach((link, index) => {
    if (link.start < offset) return;
    if (link.start > offset) messageParts.push(text.slice(offset, link.start));
    messageParts.push(
      <bdi key={`${link.start}-${index}`} dir="ltr" className="break-all">
        {text.slice(link.start, link.end)}
      </bdi>,
    );
    offset = link.end;
  });
  if (offset < text.length) messageParts.push(text.slice(offset));

  return (
    <div className="space-y-2">
      <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words">{messageParts}</p>
      {links.length > maxLinksPerMessage ? (
        <p role="alert" className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200">
          This message contains too many links to check. Links are not clickable.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link, index) => {
            const result = link.url ? results.get(link.url) : undefined;
            const parsedUrl = link.url ? new URL(link.url) : null;
            const status = link.issue
              ? "unverifiable"
              : result?.status;
            const isClean = status === "clean";
            const youtubeEmbed = link.url ? youtubeEmbedUrl(link.url) : null;
            return (
              <div
                key={`${link.start}-${index}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-black/10 bg-black/[0.035] p-2 text-xs dark:border-white/10 dark:bg-black/20"
              >
                <span className="min-w-0 flex-1 break-all font-medium" dir="ltr">
                  {parsedUrl?.hostname ?? link.raw}
                </span>
                {checking && !result && !link.issue ? (
                  <span role="status" className="text-white/55">Checking link…</span>
                ) : null}
                {isClean ? (
                  <>
                    {youtubeEmbed ? (
                      <div className="basis-full space-y-2">
                        <p className="text-emerald-700 dark:text-emerald-300">
                          YouTube video · no known threat found
                        </p>
                        <iframe
                          src={youtubeEmbed}
                          title="YouTube video"
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          className="aspect-video w-full rounded-lg border-0"
                        />
                      </div>
                    ) : (
                      <>
                        <span className="text-emerald-700 dark:text-emerald-300">
                          No known threat found
                        </span>
                        <button
                          type="button"
                          className="rounded-md bg-white/10 px-2 py-1 font-medium underline underline-offset-2 hover:bg-white/20"
                          onClick={() => openCheckedUrl(link.url!)}
                        >
                          {`Open ${parsedUrl?.hostname ?? "checked link"}${parsedUrl?.protocol === "http:" ? " (insecure)…" : ""}`}
                        </button>
                      </>
                    )}
                    {parsedUrl?.protocol === "http:" ? (
                      <span className="w-full text-amber-700 dark:text-amber-200">
                        HTTP is not encrypted in transit.
                      </span>
                    ) : null}
                    {parsedUrl?.hostname.includes("xn--") ? (
                      <span className="w-full break-all text-amber-700 dark:text-amber-200">
                        Internationalized domain; verify this exact hostname before opening.
                      </span>
                    ) : null}
                  </>
                ) : status === "threat" ? (
                  <span role="alert" className="font-semibold text-red-700 dark:text-red-300">
                    Blocked: reported for {result?.threatTypes.join(", ") || "malware or phishing"}
                  </span>
                ) : status === "unverifiable" ? (
                  <span role="alert" className="text-amber-700 dark:text-amber-200">
                    {link.issue ?? "This local or private link cannot be checked."} Opening blocked.
                  </span>
                ) : checkError ? (
                  <span role="alert" className="text-red-700 dark:text-red-300">
                    {checkError} Opening blocked.
                  </span>
                ) : result?.status === "unavailable" ? (
                  <span role="alert" className="text-amber-700 dark:text-amber-200">
                    Reputation check is not configured. Opening blocked.
                  </span>
                ) : null}
              </div>
            );
          })}
          <p className="text-[10px] opacity-60">
            Reputation checks are not a guarantee of safety. URLs are sent to Google Safe Browsing for checking.
          </p>
        </div>
      )}
    </div>
  );
}
