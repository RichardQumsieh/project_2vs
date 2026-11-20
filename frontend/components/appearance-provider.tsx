"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { applyAppearance } from "@/lib/appearance/apply";
import { panelForPath, type LocalSignals, type PanelId } from "@/lib/appearance/engine";
import { adaptiveThemeEnabled } from "@/lib/appearance/flag";
import type { AppearanceTokens } from "@/lib/appearance/schema";
import {
  activeTokens,
  activeVoice,
  approveProposal,
  commitAppearance,
  createDefaultRecord,
  dismissProposal,
  isCustomized,
  loadAppearance,
  loadPanelUses,
  recordPanelUse,
  resetAppearance,
  sanitizeUserId,
  saveAppearance,
  setAppearanceRole,
  syncProposal,
  undoAppearance,
  type AppearanceRecord,
} from "@/lib/appearance/store";
import { idbUploads } from "@/lib/appearance/upload-store";
import { uploadObjectUrl, validateUpload } from "@/lib/appearance/uploads";
import type { VoicePreferences } from "@/lib/appearance/voice";
import { currentUserId } from "@/lib/session";
import { useViewerSession } from "@/lib/use-viewer";

type PreviewState = { tokens: AppearanceTokens; voice: VoicePreferences } | null;
type AppearanceIssue = "contrast" | "upload" | "save" | null;

export type AppearanceContextValue = {
  enabled: boolean;
  userId: string;
  record: AppearanceRecord;
  panelUses: Record<PanelId, number>;
  preview: PreviewState;
  persistenceError: boolean;
  issue: AppearanceIssue;
  setPreview: (preview: PreviewState) => void;
  update: (tokens: AppearanceTokens, voice: VoicePreferences) => boolean;
  approve: () => void;
  dismiss: () => void;
  undo: () => void;
  reset: () => void;
  setRole: (role: "manager" | "family") => void;
  refreshProposal: (signals: LocalSignals, now?: Date) => void;
  uploadBackground: (file: File) => Promise<boolean>;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const emptyUses: Record<PanelId, number> = {
  inbox: 0,
  sophia: 0,
  settings: 0,
  integrations: 0,
};

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const enabled = adaptiveThemeEnabled();
  const pathname = usePathname();
  const viewer = useViewerSession();
  const userId = useMemo(() => {
    if (pathname.startsWith("/preview/appearance")) return "preview";
    return sanitizeUserId(viewer.data?.user.id ?? currentUserId());
  }, [pathname, viewer.data?.user.id]);
  const [record, setRecord] = useState<AppearanceRecord>(() => createDefaultRecord());
  const [panelUses, setPanelUses] = useState<Record<PanelId, number>>(emptyUses);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [persistenceError, setPersistenceError] = useState(false);
  const [issue, setIssue] = useState<AppearanceIssue>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setRecord(loadAppearance(userId));
    setPanelUses(loadPanelUses(userId));
    setPreview(null);
    setIssue(null);
    setPersistenceError(false);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled) return;
    const panel = panelForPath(pathname);
    if (!panel) return;
    setPanelUses(recordPanelUse(userId, panel));
  }, [enabled, pathname, userId]);

  const persist = useCallback(
    (next: AppearanceRecord) => {
      const saved = saveAppearance(userId, next);
      setPersistenceError(!saved);
      if (!saved) setIssue("save");
      return saved;
    },
    [userId],
  );

  const update = useCallback(
    (tokens: AppearanceTokens, voice: VoicePreferences) => {
      const result = commitAppearance(record, tokens, voice, "user");
      if (!result.ok) {
        setIssue("contrast");
        return false;
      }
      if (!persist(result.record)) return false;
      setRecord(result.record);
      setPreview(null);
      setIssue(null);
      return true;
    },
    [persist, record],
  );

  const approve = useCallback(() => {
    const next = approveProposal(record);
    if (!persist(next)) return;
    setRecord(next);
    setPreview(null);
    setIssue(null);
  }, [persist, record]);

  const dismiss = useCallback(() => {
    const next = dismissProposal(record);
    if (!persist(next)) return;
    setRecord(next);
    setPreview(null);
  }, [persist, record]);

  const undo = useCallback(() => {
    const next = undoAppearance(record);
    if (!persist(next)) return;
    setRecord(next);
    setPreview(null);
  }, [persist, record]);

  const reset = useCallback(() => {
    const next = resetAppearance(record);
    if (!persist(next)) return;
    setRecord(next);
    setPreview(null);
    setIssue(null);
  }, [persist, record]);

  const setRole = useCallback(
    (role: "manager" | "family") => {
      const next = setAppearanceRole(record, role);
      if (next === record) return;
      if (!persist(next)) return;
      setRecord(next);
    },
    [persist, record],
  );

  const refreshProposal = useCallback(
    (signals: LocalSignals, now = new Date()) => {
      const next = syncProposal(record, signals, now);
      if (next === record) return;
      if (!persist(next)) return;
      setRecord(next);
    },
    [persist, record],
  );

  const uploadBackground = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checked = validateUpload({ mime: file.type, bytes });
      if (!checked.ok) {
        setIssue("upload");
        return false;
      }
      const id = crypto.randomUUID();
      await idbUploads().put({
        id,
        userId,
        mime: checked.mime,
        bytes,
        createdAt: new Date().toISOString(),
      });
      return update(
        { ...activeTokens(record), background: { kind: "upload", id } },
        activeVoice(record),
      );
    },
    [record, update, userId],
  );

  useEffect(() => {
    if (!enabled) {
      applyAppearance(null);
      return;
    }
    const tokens = preview?.tokens ?? (isCustomized(record) ? activeTokens(record) : null);
    let cancelled = false;
    void (async () => {
      let uploadUrl: string | null = null;
      if (tokens?.background.kind === "upload") {
        const stored = await idbUploads().get(userId, tokens.background.id);
        if (stored) uploadUrl = uploadObjectUrl(stored);
      }
      if (cancelled) {
        if (uploadUrl) URL.revokeObjectURL(uploadUrl);
        return;
      }
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = uploadUrl;
      applyAppearance(tokens, { uploadUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, preview, record, userId]);

  useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      enabled,
      userId,
      record,
      panelUses,
      preview,
      persistenceError,
      issue,
      setPreview,
      update,
      approve,
      dismiss,
      undo,
      reset,
      setRole,
      refreshProposal,
      uploadBackground,
    }),
    [
      approve,
      dismiss,
      enabled,
      issue,
      panelUses,
      persistenceError,
      preview,
      record,
      refreshProposal,
      reset,
      setRole,
      undo,
      update,
      uploadBackground,
      userId,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return value;
}
