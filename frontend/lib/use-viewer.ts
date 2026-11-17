"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";

export function useViewerSession() {
  return useQuery({
    queryKey: ["session", "me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 15_000,
  });
}
