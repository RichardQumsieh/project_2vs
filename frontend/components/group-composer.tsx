"use client";

import {
  Paperclip,
  Send,
  Smile,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { PhotoEditor } from "@/components/photo-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  VoiceNoteRecorder,
  type RecordedVoiceNote,
} from "@/components/voice-note-recorder";
import {
  encodeReplyPayload,
  maxAlbumPhotos,
  maxReplyRefs,
  messagePreviewText,
} from "@/lib/chat-payload";
import { maxPhotoBytes } from "@/lib/crypto/media";
import { maxFileAttachmentBytes, sanitizeAttachmentName } from "@/lib/crypto/file-attachment";
import type { LocalMessage } from "@/lib/crypto/types";
import { maxVideoSourceBytes } from "@/lib/crypto/video";
import { useI18n } from "@/lib/i18n/locale";
import {
  prepareChatMediaPlaintext,
  prepareFileAttachment,
} from "@/lib/prepare-chat-media";
import type { EncryptedFileAttachment } from "@/lib/crypto/file-attachment";
import { applyMention, memberLabel, mentionQuery, mentionSuggestions, type MentionMember } from "@/lib/group-presentation";
import { sendGroupTyping } from "@/lib/group-typing-client";
import { assertOutgoingLinksSafe } from "@/lib/url-safety";

const COMPOSER_EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉",
  "😊", "😍", "🥰", "😘", "😎", "🤔", "🥺", "😭",
  "😢", "😴", "🙌", "👏", "🙏", "👍", "👎", "🤝",
  "❤️", "💛", "💚", "💙", "💜", "🔥", "🎉", "✨",
  "💯", "🌹", "☕", "🌙", "✅", "🤍", "💪", "🫶",
];

export function GroupComposer({
  conversationId,
  joined,
  messages,
  members = [],
  disabled,
  onSendPlaintext,
}: {
  conversationId: string;
  joined: boolean;
  messages: readonly LocalMessage[];
  members?: readonly (MentionMember & { userId?: string })[];
  disabled: boolean;
  onSendPlaintext: (plaintext: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [selectedVoiceNote, setSelectedVoiceNote] = useState<RecordedVoiceNote | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    file: File;
    encrypted: EncryptedFileAttachment;
  } | null>(null);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [recordingVoiceNote, setRecordingVoiceNote] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [replySelectMode, setReplySelectMode] = useState(false);
  const [selectedReplyIds, setSelectedReplyIds] = useState<string[]>([]);
  const [caret, setCaret] = useState(0);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrls = useRef<string[]>([]);
  const selectedPhoto = selectedPhotos[0] ?? null;

  useEffect(() => {
    photoPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    photoPreviewUrls.current = selectedPhotos.map((file) => URL.createObjectURL(file));
    return () => {
      photoPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      photoPreviewUrls.current = [];
    };
  }, [selectedPhotos]);

  const busy = disabled || sending || recordingVoiceNote || preparingFile || !joined;
  const hasAttachment = Boolean(
    selectedPhotos.length || selectedVideo || selectedVoiceNote || selectedFile,
  );

  function clearAttachments() {
    setSelectedPhotos([]);
    setSelectedVideo(null);
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    setPhotoEditorOpen(false);
  }

  function insertEmoji(emoji: string) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    setDraft(next);
    setEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function toggleReply(messageId: string) {
    setSelectedReplyIds((current) => {
      if (current.includes(messageId)) return current.filter((id) => id !== messageId);
      if (current.length >= maxReplyRefs) return current;
      return [...current, messageId];
    });
  }

  async function handlePhotoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])].slice(0, maxAlbumPhotos);
    event.currentTarget.value = "";
    setError(null);
    setSelectedVideo(null);
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    if (!files.length) {
      setSelectedPhotos([]);
      setPhotoEditorOpen(false);
      return;
    }
    if (files.some((file) => file.size > maxPhotoBytes)) {
      setSelectedPhotos([]);
      setPhotoEditorOpen(false);
      setError("Each photo must be 6 MB or smaller.");
      return;
    }
    setSelectedPhotos(files);
    setPhotoEditorOpen(files.length === 1);
  }

  async function handleVideoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setError(null);
    setSelectedPhotos([]);
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    setPhotoEditorOpen(false);
    if (!file) {
      setSelectedVideo(null);
      return;
    }
    if (file.size > maxVideoSourceBytes) {
      setSelectedVideo(null);
      setError("Videos must be 500 MB or smaller before compression.");
      return;
    }
    setSelectedVideo(file);
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setError(null);
    clearAttachments();
    if (!file) return;
    if (file.size === 0 || file.size > maxFileAttachmentBytes) {
      setError("Files must be non-empty and 450 MB or smaller.");
      return;
    }
    try {
      sanitizeAttachmentName(file.name);
      setPreparingFile(true);
      const encrypted = await prepareFileAttachment(file);
      setSelectedFile({ file, encrypted });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected file could not be verified.");
    } finally {
      setPreparingFile(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setSending(true);
    try {
      let plaintext: string;
      const caption = draft.trim();
      if (selectedPhotos.length > 1) {
        plaintext = await prepareChatMediaPlaintext(conversationId, {
          kind: "album",
          files: selectedPhotos,
          caption,
        });
      } else if (selectedPhotos.length === 1 && selectedPhoto) {
        plaintext = await prepareChatMediaPlaintext(conversationId, {
          kind: "photo",
          file: selectedPhoto,
          caption,
        });
      } else if (selectedVideo) {
        plaintext = await prepareChatMediaPlaintext(conversationId, {
          kind: "video",
          file: selectedVideo,
          caption,
        });
      } else if (selectedVoiceNote) {
        plaintext = await prepareChatMediaPlaintext(conversationId, {
          kind: "voice",
          file: selectedVoiceNote.file,
          duration: selectedVoiceNote.duration,
          caption: caption || selectedVoiceNote.transcript,
        });
      } else if (selectedFile) {
        plaintext = await prepareChatMediaPlaintext(conversationId, {
          kind: "file",
          attachment: selectedFile.encrypted,
          caption,
        });
      } else if (selectedReplyIds.length > 0) {
        if (!caption) throw new Error("Write a reply before sending.");
        await assertOutgoingLinksSafe(caption);
        const refs = selectedReplyIds
          .map((id) => messages.find((message) => message.id === id))
          .filter((message): message is LocalMessage => Boolean(message))
          .slice(0, maxReplyRefs)
          .map((message) => ({
            id: message.logicalMessageId ?? message.id,
            preview: messagePreviewText(message.plaintext),
            fromMe: message.fromMe,
            sender: message.fromMe
              ? undefined
              : memberLabel(members.find((member) => member.userId === message.senderUserId), "Member"),
          }));
        if (!refs.length) throw new Error("Select at least one message to reply to.");
        plaintext = encodeReplyPayload({ refs, body: caption });
      } else {
        if (!caption) return;
        await assertOutgoingLinksSafe(caption);
        plaintext = caption;
      }
      await onSendPlaintext(plaintext);
      setDraft("");
      clearAttachments();
      setSelectedReplyIds([]);
      setReplySelectMode(false);
      setAttachmentMenuOpen(false);
      setEmojiPickerOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative shrink-0 border-t border-white/10 bg-[#070b12] p-3">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="sr-only"
        title={t("chat.photos")}
        aria-label={t("chat.photos")}
        onChange={(event) => void handlePhotoSelection(event)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/*"
        className="sr-only"
        title={t("chat.videoFile")}
        aria-label={t("chat.videoFile")}
        onChange={(event) => void handleVideoSelection(event)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.pptx,.xlsx,.txt,.csv,application/pdf,text/plain,text/csv"
        className="sr-only"
        title={t("group.attach")}
        aria-label={t("group.attach")}
        onChange={(event) => void handleFileSelection(event)}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={replySelectMode ? "default" : "outline"}
          disabled={!joined}
          title={replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
          aria-label={replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
          aria-pressed={replySelectMode}
          onClick={() => {
            if (replySelectMode) setSelectedReplyIds([]);
            setReplySelectMode((open) => !open);
          }}
        >
          {replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
        </Button>
        {selectedReplyIds.length > 0 ? (
          <span className="text-xs text-cyan-100/80">
            {t("chat.replyTo", { count: selectedReplyIds.length })}
          </span>
        ) : null}
      </div>

      {replySelectMode || selectedReplyIds.length ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-50/85">
          <p>
            {selectedReplyIds.length
              ? `${selectedReplyIds.length} message${selectedReplyIds.length === 1 ? "" : "s"} selected for one reply`
              : "Tap Include on messages to answer several at once"}
          </p>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              setSelectedReplyIds([]);
              setReplySelectMode(false);
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      {hasAttachment ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2">
          {selectedPhotos.length ? (
            <div className="flex max-w-[min(70vw,18rem)] gap-1 overflow-x-auto">
              {selectedPhotos.map((file, index) => (
                <span key={`${file.name}-${index}`} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoPreviewUrls.current[index]}
                    alt=""
                    className="size-14 rounded-lg object-cover"
                  />
                </span>
              ))}
            </div>
          ) : selectedVideo ? (
            <p className="truncate text-xs text-white/75">{selectedVideo.name}</p>
          ) : selectedVoiceNote ? (
            <p className="text-xs text-white/75">
              Voice note · {Math.floor(selectedVoiceNote.duration)}s
            </p>
          ) : selectedFile ? (
            <p className="truncate text-xs text-white/75">{selectedFile.encrypted.name}</p>
          ) : null}
          {selectedPhotos.length === 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              title="Edit photo"
              aria-label="Edit photo"
              onClick={() => setPhotoEditorOpen(true)}
            >
              Edit
            </Button>
          ) : null}
          <button
            type="button"
            className="ms-auto inline-flex items-center gap-1 rounded-full px-2 py-2 text-xs text-white/70 hover:bg-white/10"
            title="Remove attachment"
            aria-label="Remove attachment"
            disabled={busy}
            onClick={clearAttachments}
          >
            <X aria-hidden="true" className="size-4" />
            Remove
          </button>
        </div>
      ) : null}

      {emojiPickerOpen ? (
        <div
          id="group-emoji-picker"
          role="group"
          aria-label="Choose an emoji"
          className="absolute bottom-full left-3 z-40 mb-2 grid max-h-56 w-[min(19rem,calc(100vw-1.5rem))] grid-cols-8 gap-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#151618] p-2 shadow-2xl"
        >
          {COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              title={`Insert ${emoji}`}
              className="grid size-9 place-items-center rounded-lg text-xl hover:bg-white/10"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => insertEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      {attachmentMenuOpen ? (
        <div
          id="group-attachment-menu"
          role="group"
          aria-label="Choose attachment type"
          className="absolute bottom-full left-3 z-40 mb-2 flex w-[min(16rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-white/10 bg-[#151618] p-2 shadow-2xl"
        >
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              setAttachmentMenuOpen(false);
              photoInputRef.current?.click();
            }}
          >
            Photos (1–{maxAlbumPhotos}, with editor)
          </button>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              setAttachmentMenuOpen(false);
              videoInputRef.current?.click();
            }}
          >
            Video (up to 75 seconds)
          </button>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              setAttachmentMenuOpen(false);
              fileInputRef.current?.click();
            }}
          >
            Document (up to 450 MB)
          </button>
        </div>
      ) : null}

      {(() => {
        const query = mentionQuery(draft, caret);
        const matches = query ? mentionSuggestions(members, query.query) : [];
        if (!query || matches.length === 0) return null;
        return (
          <ul className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#12151c]" aria-label="Mention a member">
            {matches.map((member) => {
              const label = member.displayName?.trim() || member.username;
              return (
                <li key={member.username}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                    onClick={() => {
                      const next = applyMention(draft, query.start, caret, member.username);
                      setDraft(next.text);
                      setCaret(next.caret);
                    }}
                  >
                    <span>{label}</span>
                    <span className="text-xs text-white/45">@{member.username}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        );
      })()}

      <form className="flex items-end gap-2" onSubmit={(event) => void submit(event)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-white/65"
          disabled={busy || hasAttachment}
          title="Attach photo, video, or document"
          aria-label="Attach photo, video, or document"
          aria-expanded={attachmentMenuOpen}
          aria-controls="group-attachment-menu"
          onClick={() => {
            setEmojiPickerOpen(false);
            setAttachmentMenuOpen((open) => !open);
          }}
        >
          <Paperclip aria-hidden="true" className="size-5" />
        </Button>
        <VoiceNoteRecorder
          disabled={busy || hasAttachment}
          onRecorded={(note) => {
            clearAttachments();
            setSelectedVoiceNote(note);
            setDraft(note.transcript);
            setError(note.transcriptionError ?? null);
          }}
          onError={setError}
          onRecordingChange={setRecordingVoiceNote}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-white/65"
          disabled={!joined || sending}
          title={emojiPickerOpen ? "Close emoji picker" : "Open emoji picker"}
          aria-label={emojiPickerOpen ? "Close emoji picker" : "Open emoji picker"}
          aria-expanded={emojiPickerOpen}
          aria-controls="group-emoji-picker"
          onClick={() => {
            setAttachmentMenuOpen(false);
            setEmojiPickerOpen((open) => !open);
          }}
        >
          <Smile aria-hidden="true" className="size-5" />
        </Button>
        <Input
          ref={composerInputRef}
          dir="auto"
          title={t("group.messageLabel")}
          aria-label={t("group.messageLabel")}
          placeholder={
            hasAttachment
              ? t("chat.caption")
              : selectedReplyIds.length
                ? t("chat.replyTo", { count: selectedReplyIds.length })
                : joined
                  ? t("group.messagePlaceholder")
                  : t("group.waitingJoin")
          }
          value={draft}
          disabled={!joined || sending}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            if (joined && event.target.value.trim()) sendGroupTyping(conversationId);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? draft.length)}
          maxLength={16000}
          className="h-11 min-w-0 flex-1 rounded-2xl border-white/10 bg-white/[0.035]"
        />
        <Button
          type="submit"
          size="icon"
          className="size-9 shrink-0"
          title={selectedReplyIds.length ? t("chat.sendReply") : t("group.send")}
          aria-label={selectedReplyIds.length ? t("chat.sendReply") : t("group.send")}
          disabled={
            busy ||
            (!hasAttachment && !draft.trim() && selectedReplyIds.length === 0)
          }
        >
          <Send aria-hidden="true" className="size-4" />
        </Button>
      </form>

      {replySelectMode ? (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
          {messages.map((message) => {
            const selected = selectedReplyIds.includes(message.id);
            return (
              <li key={message.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected}
                    disabled={!selected && selectedReplyIds.length >= maxReplyRefs}
                    onChange={() => toggleReply(message.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-white/75">
                    {message.fromMe ? t("group.you") : t("group.member")}
                    {" · "}
                    {messagePreviewText(message.plaintext)}
                  </span>
                  <span className="shrink-0 text-white/40">{t("chat.includeReply")}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {sending ? (
        <p role="status" className="mt-2 text-center text-xs text-white/50">
          Encrypting and sending…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-center text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {photoEditorOpen && selectedPhoto ? (
        <PhotoEditor
          file={selectedPhoto}
          onCancel={() => {
            setPhotoEditorOpen(false);
            setSelectedPhotos([]);
          }}
          onSave={(file) => {
            setSelectedPhotos([file]);
            setPhotoEditorOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
