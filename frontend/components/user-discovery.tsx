"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UserDiscovery({
  userId,
  interests,
}: {
  userId: string;
  interests: string[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(interests.join(", "));
  const [error, setError] = useState<string | null>(null);
  const normalizedInterests = interests.join("|");
  const recommendations = useQuery({
    queryKey: ["user-recommendations", userId, normalizedInterests],
    queryFn: api.recommendations,
    enabled: interests.length > 0,
    staleTime: 60_000,
  });

  const saveInterests = useMutation({
    mutationFn: (nextInterests: string[]) => api.updateProfile(nextInterests),
    onSuccess: async ({ user }) => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({
          queryKey: ["user-recommendations", userId],
        }),
      ]);
      setDraft(user.interests.join(", "));
    },
    onError: (reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Could not save your interests.",
      );
    },
  });

  const startConversation = useMutation({
    mutationFn: (username: string) => api.createDirect(username),
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({
        queryKey: ["conversations", userId],
      });
      router.push(`/inbox/${conversation.id}`);
    },
    onError: (reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Could not start conversation.",
      );
    },
  });

  function submitInterests(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextInterests = [...new Set(
      draft
        .split(",")
        .map((interest) => interest.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean),
    )];
    if (nextInterests.length > 20 || nextInterests.some((item) => item.length > 40)) {
      setError("Enter up to 20 interests, each 40 characters or fewer.");
      return;
    }
    saveInterests.mutate(nextInterests);
  }

  return (
    <section className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
      <div>
        <h2 className="text-sm font-medium">People with similar interests</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Suggestions compare profile interests only—never private chats. Interests are visible to signed-in users.
        </p>
      </div>
      <form className="space-y-2" onSubmit={submitInterests}>
        <label
          htmlFor="discovery-interests"
          className="text-xs text-white/60"
        >
          Your interests, separated by commas
        </label>
        <Input
          id="discovery-interests"
          value={draft}
          maxLength={838}
          placeholder="e.g. hiking, photography, cooking"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setError(null);
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={saveInterests.isPending}
        >
          {saveInterests.isPending ? "Saving…" : "Save interests"}
        </Button>
      </form>

      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
      {recommendations.isError ? (
        <p role="alert" className="text-xs text-red-300">
          {recommendations.error instanceof Error
            ? recommendations.error.message
            : "Could not load recommendations."}
        </p>
      ) : null}
      {recommendations.isPending && interests.length > 0 ? (
        <p role="status" className="text-xs text-white/45">Finding shared interests…</p>
      ) : null}
      {interests.length === 0 ? (
        <p className="text-xs text-white/45">Add interests to see relevant people.</p>
      ) : null}
      <ul className="space-y-2">
        {(recommendations.data?.users ?? []).map((user) => {
          const shared = user.interests.filter((interest) =>
            interests.includes(interest),
          );
          return (
            <li
              key={user.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {user.displayName ?? user.username}
                </p>
                <p className="truncate text-[10px] text-white/40">
                  @{user.username} · {shared.join(", ")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={startConversation.isPending}
                onClick={() => startConversation.mutate(user.username)}
              >
                Chat
              </Button>
            </li>
          );
        })}
      </ul>
      {recommendations.data?.users.length === 0 && interests.length > 0 ? (
        <p className="text-xs text-white/45">No matches yet. Try adding more interests.</p>
      ) : null}
    </section>
  );
}
