import * as Localization from "expo-localization";

const en = {
  deleteTitle: "Delete this message?",
  deleteForMe: "Delete for me",
  deleteForEveryone: "Delete for everyone",
  cancel: "Cancel",
  reply: "Reply",
  copy: "Copy",
  select: "Select",
  delete: "Delete",
  undo: "Undo",
  deletedForYou: "Deleted for you",
  deletingForEveryone: "Deleting for everyone",
  scrollToLatest: "Scroll to latest messages",
  loadEarlier: "Load earlier messages",
  loadingEarlier: "Loading earlier messages",
  emptyTitle: "A fresh start",
  emptyCopy: "Messages are private to the people in this conversation. Send the first note when you're ready.",
  mediaUnavailable: "Couldn't open this attachment",
  retry: "Retry",
  photo: "Photo",
  video: "Video",
  voiceNote: "Voice note",
  loading: "Loading",
  save: "Save",
  share: "Share",
  saved: "Saved on this device",
  voiceCall: "Start voice call",
  videoCall: "Start video call",
  private: "Private",
  endToEnd: "End-to-end encrypted",
  lockTitle: "Lock messaging",
  lockMeta: "After you leave the app",
  lockImmediate: "Immediately",
  lock30: "After 30 seconds",
  lock60: "After 1 minute",
  lockHelp: "Choose when Sophia locks encrypted chats after you leave. Opening the camera, photo library, or a permission prompt does not lock the vault.",
  couldNotSave: "This photo could not be saved.",
  couldNotShare: "This photo could not be shared.",
  encryptedPreview: "Encrypted message",
};

const ar: typeof en = {
  deleteTitle: "حذف هذه الرسالة؟",
  deleteForMe: "الحذف لدي",
  deleteForEveryone: "الحذف لدى الجميع",
  cancel: "إلغاء",
  reply: "رد",
  copy: "نسخ",
  select: "تحديد",
  delete: "حذف",
  undo: "تراجع",
  deletedForYou: "حُذفت لديك",
  deletingForEveryone: "جارٍ الحذف لدى الجميع",
  scrollToLatest: "الانتقال إلى أحدث الرسائل",
  loadEarlier: "تحميل الرسائل الأقدم",
  loadingEarlier: "جارٍ تحميل الرسائل الأقدم",
  emptyTitle: "بداية جديدة",
  emptyCopy: "الرسائل خاصة بالأشخاص في هذه المحادثة. أرسل أول ملاحظة عندما تكون جاهزًا.",
  mediaUnavailable: "تعذر فتح هذا المرفق",
  retry: "إعادة المحاولة",
  photo: "صورة",
  video: "فيديو",
  voiceNote: "رسالة صوتية",
  loading: "جارٍ التحميل",
  save: "حفظ",
  share: "مشاركة",
  saved: "تم الحفظ على هذا الجهاز",
  voiceCall: "بدء مكالمة صوتية",
  videoCall: "بدء مكالمة فيديو",
  private: "خاصة",
  endToEnd: "مشفرة من الطرف إلى الطرف",
  lockTitle: "قفل الرسائل",
  lockMeta: "بعد مغادرة التطبيق",
  lockImmediate: "فورًا",
  lock30: "بعد 30 ثانية",
  lock60: "بعد دقيقة",
  lockHelp: "اختر متى تقفل صوفيا المحادثات المشفرة بعد مغادرتك. فتح الكاميرا أو مكتبة الصور أو طلب الإذن لا يقفل الخزنة.",
  couldNotSave: "تعذر حفظ هذه الصورة.",
  couldNotShare: "تعذر مشاركة هذه الصورة.",
  encryptedPreview: "رسالة مشفرة",
};

export type CopyKey = keyof typeof en;

export function appLocale(): "en" | "ar" {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === "ar" ? "ar" : "en";
}

export function t(key: CopyKey): string {
  return (appLocale() === "ar" ? ar : en)[key];
}
