import { Ionicons } from "@expo/vector-icons";
import { reloadAppAsync } from "expo";
import * as Haptics from "expo-haptics";
import * as Localization from "expo-localization";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { messagePreviewText } from "../frontend/lib/chat-payload";
import { conversationPlaintext, isUnlocked, lockDevice } from "../frontend/lib/session";
import { api, API_URL, ApiError, clearApiCookie, restoreApiCookie, setApiCookie, WEB_URL, type Conversation, type DailyBrief, type SessionUser, type Task, type TotpSetup, type User, type Workspace, type WorkspaceInvite, type WorkspaceMember } from "./src/api";
import { currentLockDelayMs, type LockDelayMs } from "./src/app-lock";
import { loadLockDelayMs, saveLockDelayMs } from "./src/app-lock-store";
import { CallProvider, useCallControls } from "./src/call-session";
import { t } from "./src/i18n";
import { wipeDecryptedCache } from "./src/media-cache";
import { NativeThread } from "./src/native-thread";
import { useColors } from "./src/theme";
import { ActionButton, Avatar, C, Card, EmptyState, Eyebrow, FadeIn, Heading, Input, LoadingLine, Notice, RoundAction } from "./src/ui";

const NativeWebView: any = WebView;

type Tab = "today" | "inbox" | "plan" | "spaces" | "you";
type Page = Tab | "assistant" | "chat" | "web";
const TABS: { id: Tab; title: string; icon: keyof typeof Ionicons.glyphMap; selected: keyof typeof Ionicons.glyphMap }[] = [
  { id: "today", title: "Today", icon: "sunny-outline", selected: "sunny" },
  { id: "inbox", title: "Inbox", icon: "chatbubbles-outline", selected: "chatbubbles" },
  { id: "plan", title: "Plan", icon: "checkbox-outline", selected: "checkbox" },
  { id: "spaces", title: "Spaces", icon: "people-outline", selected: "people" },
  { id: "you", title: "You", icon: "person-outline", selected: "person" },
];
const CONSENT_VERSION = "cloud-sophia-v1";
const CONSENT_PURPOSE = "Sophia may read authorized mail, calendar, connected work items, and messages the user has allowed, in order to propose actions";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
function dateLabel() {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}
function prettyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
function conversationName(item: Conversation) {
  return item.type === "GROUP" ? item.title || "Group conversation" : item.peer?.displayName || `@${item.peer?.username || "person"}`;
}

export default function App() {
  useEffect(() => {
    const rtl = Localization.getLocales()[0]?.languageCode === "ar";
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL === rtl) return;
    I18nManager.forceRTL(rtl);
    void reloadAppAsync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider><AppContent /></SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppContent() {
  const [cookie, setCookie] = useState<string | null>(null);
  const [profile, setProfile] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState<Page>("today");
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const colors = useColors();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await restoreApiCookie();
        if (!saved) return;
        const response = await api.me(saved);
        if (alive) { setCookie(saved); setProfile(response.user); }
      } catch {
        await clearApiCookie().catch(() => undefined);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const signIn = useCallback(async (session: string) => {
    const response = await api.me(session);
    setApiCookie(session);
    setCookie(session);
    setProfile(response.user);
    setPage("today");
  }, []);

  useEffect(() => {
    void loadLockDelayMs().catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    const session = cookie;
    await wipeDecryptedCache().catch(() => undefined);
    await lockDevice();
    setCookie(null); setProfile(null); setPage("today"); setActiveConversation(null);
    if (session) await api.logout(session).catch(() => undefined);
    await clearApiCookie().catch(() => undefined);
  }, [cookie]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (page === "chat" || page === "assistant" || page === "web") { setPage(page === "chat" ? "inbox" : page === "assistant" ? "today" : "you"); return true; }
      if (page !== "today") { setPage("today"); setActiveTab("today"); return true; }
      return false;
    });
    return () => sub.remove();
  }, [page]);

  function navigate(next: Page) {
    void Haptics.selectionAsync().catch(() => undefined);
    setPage(next);
    if (TABS.some((tab) => tab.id === next)) setActiveTab(next as Tab);
  }

  function openConversation(conversation: Conversation) {
    setActiveConversation(conversation);
    setPage("chat");
  }

  if (booting) return <Startup />;
  if (!cookie || !profile) return <Login onSignedIn={signIn} />;

  const isSubpage = page === "assistant" || page === "chat" || page === "web";
  const themedChrome = page === "chat" || page === "inbox";
  const title = page === "assistant" ? "Ask Sophia" : page === "web" ? "Connected tools" : page === "chat" ? activeConversation ? conversationName(activeConversation) : "Conversation" : null;
  return <CallProvider cookie={cookie} userId={profile.id}><SafeAreaView style={[styles.safe, themedChrome && { backgroundColor: colors.bg }]}>
    <StatusBar barStyle={themedChrome ? colors.statusBar : "dark-content"} />
    <View style={[styles.appHeader, themedChrome && { backgroundColor: colors.bg, borderBottomColor: colors.line }]}>
      {isSubpage ? <RoundAction icon="chevron-back" accessibilityLabel="Go back" onPress={() => navigate(page === "chat" ? "inbox" : page === "assistant" ? "today" : "you")} /> : <Brand />}
      {isSubpage ? <Text numberOfLines={1} style={[styles.subpageTitle, themedChrome && { color: colors.ink }]}>{title}</Text> : <Text style={styles.headerWordmark}>sophia</Text>}
      {page === "chat" && activeConversation ? <ChatHeaderActions conversation={activeConversation} /> :
        <Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => navigate("you")} style={styles.profileButton}>
          <Avatar title={profile.displayName || profile.username} size={36} />
        </Pressable>}
    </View>

    <KeyboardAvoidingView style={[styles.main, themedChrome && { backgroundColor: colors.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
      {page === "today" && <Today cookie={cookie} profile={profile} onAsk={() => navigate("assistant")} onPlan={() => navigate("plan")} />}
      {page === "inbox" && <Inbox cookie={cookie} onOpen={openConversation} />}
      {page === "plan" && <Plan cookie={cookie} />}
      {page === "spaces" && <Spaces cookie={cookie} myUserId={profile.id} onOpenConversation={openConversation} />}
      {page === "you" && <You profile={profile} onSignOut={signOut} onAsk={() => navigate("assistant")} onTools={() => navigate("web")} />}
      {page === "assistant" && <AskSophia cookie={cookie} />}
      {page === "chat" && activeConversation && <NativeChat conversation={activeConversation} cookie={cookie} />}
      {page === "web" && <NativeWebPage path="/settings/integrations" />}
    </KeyboardAvoidingView>

    {!isSubpage && <View style={styles.tabBar} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => navigate(tab.id)} style={styles.tab}>
          <View style={[styles.tabIcon, selected && styles.tabIconActive]}><Ionicons name={selected ? tab.selected : tab.icon} size={20} color={selected ? C.purple : C.muted} /></View>
          <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.title}</Text>
        </Pressable>;
      })}
    </View>}
  </SafeAreaView></CallProvider>;
}

function Startup() {
  return <SafeAreaView style={[styles.safe, styles.center]}><StatusBar barStyle="dark-content" /><Brand large /><ActivityIndicator color={C.purple} style={{ marginTop: 26 }} /><Text style={styles.startupLabel}>Preparing your space</Text></SafeAreaView>;
}

function ChatHeaderActions({ conversation }: { conversation: Conversation }) {
  const calls = useCallControls();
  const colors = useColors();
  return <View style={styles.headerActions}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("voiceCall")} onPress={() => void calls.startCall(conversation, "audio")} style={styles.headerIcon}>
      <Ionicons name="call-outline" size={20} color={colors.purple} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("videoCall")} onPress={() => void calls.startCall(conversation, "video")} style={styles.headerIcon}>
      <Ionicons name="videocam-outline" size={20} color={colors.purple} />
    </Pressable>
    <View style={styles.securePill}><Ionicons name="shield-checkmark" size={13} color={C.green} /><Text style={styles.securePillText}>{t("private")}</Text></View>
  </View>;
}

function Brand({ large = false }: { large?: boolean }) {
  return <View style={styles.brandRow}><View style={[styles.brandMark, large && { width: 58, height: 58, borderRadius: 20 }]}><Text style={[styles.brandLetter, large && { fontSize: 37 }]}>s</Text></View>{large && <Text style={styles.brandLarge}>sophia</Text>}</View>;
}

function Login({ onSignedIn }: { onSignedIn: (cookie: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [code, setCode] = useState("");
  const [signup, setSignup] = useState(false);
  const [mfa, setMfa] = useState(false);
  const [step, setStep] = useState<"credentials" | "authenticator" | "recoveryCodes">("credentials");
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      if (step === "recoveryCodes") {
        if (!codesSaved) return;
        const session = await restoreApiCookie();
        if (!session) throw new Error("Sophia created your account but did not return a session. Please sign in.");
        await onSignedIn(session);
        return;
      }

      if (step === "authenticator") {
        if (!totpSetup) throw new Error("Authenticator setup expired. Go back and sign in again.");
        const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
        if (normalizedCode.length !== 6) throw new Error("Enter the 6-digit code from your authenticator app.");
        const result = await api.confirmTotp({ setupToken: totpSetup.setupToken, code: normalizedCode });
        setRecoveryCodes(result.recoveryCodes);
        setCodesSaved(false);
        setCode("");
        setStep("recoveryCodes");
        return;
      }

      if (signup) {
        if (password !== passwordConfirm) throw new Error("Your passwords do not match.");
        const result = await api.register({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          email: email.trim(),
          password,
          passwordConfirm,
        });
        setTotpSetup(result);
        setStep("authenticator");
        setCode("");
        return;
      }

      const result = await api.login({ email: email.trim(), password, ...(mfa ? { code: code.trim() } : {}) });
      if ("mfaRequired" in result && result.mfaRequired) {
        setMfa(true);
        setError("Enter your authenticator code or an unused account recovery code.");
        return;
      }
      if ("setupRequired" in result && result.setupRequired) {
        setTotpSetup(result);
        setStep("authenticator");
        setCode("");
        setError("Finish setting up your authenticator to protect this account.");
        return;
      }
      const session = await restoreApiCookie();
      if (!session) throw new Error("Sophia signed you in but did not return a session. Please try again.");
      await onSignedIn(session);
      setPassword(""); setCode("");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }

  function changeMode(nextSignup: boolean) {
    setSignup(nextSignup);
    setMfa(false);
    setStep("credentials");
    setTotpSetup(null);
    setRecoveryCodes([]);
    setCodesSaved(false);
    setCode("");
    setError("");
  }

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.authScrollContent}>
      <KeyboardAvoidingView style={styles.loginScreen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Brand large />
      <View style={{ marginTop: 32 }}><Eyebrow color={C.purple}>{step === "authenticator" ? "SECURE YOUR ACCOUNT" : step === "recoveryCodes" ? "SAVE THESE ONCE" : "YOUR DAY, IN GOOD HANDS"}</Eyebrow><Text style={styles.loginTitle}>{step === "authenticator" ? "Add your authenticator." : step === "recoveryCodes" ? "Keep a way back in." : signup ? "Make room for Sophia." : <>A little more{`\n`}room to think.</>}</Text><Text style={styles.loginCopy}>{step === "authenticator" ? "Add Sophia to an authenticator app, then enter the 6-digit code it shows." : step === "recoveryCodes" ? "These one-time codes can recover your account if you lose your authenticator. Save them somewhere private." : signup ? "Create your Sophia account and secure it with two-step verification." : "Your conversations and chief of staff, together in one calm space."}</Text></View>
      <View style={styles.loginForm}>
        {step === "credentials" && signup && <Input label="YOUR NAME" value={displayName} onChangeText={setDisplayName} placeholder="How people know you" autoComplete="name" editable={!busy} returnKeyType="next" />}
        {step === "credentials" && signup && <Input label="USERNAME" value={username} onChangeText={(value) => setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24))} placeholder="3–24 letters, numbers, or _" autoCapitalize="none" autoCorrect={false} editable={!busy} returnKeyType="next" />}
        {step === "credentials" && <Input label="EMAIL ADDRESS" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" editable={!busy} returnKeyType="next" />}
        {step === "credentials" && <Input label="PASSWORD" value={password} onChangeText={setPassword} placeholder="Use a strong, unique password" secureTextEntry autoComplete={signup ? "new-password" : "password"} editable={!busy} returnKeyType={signup ? "next" : "done"} onSubmitEditing={signup ? undefined : submit} />}
        {step === "credentials" && signup && <Input label="CONFIRM PASSWORD" value={passwordConfirm} onChangeText={setPasswordConfirm} placeholder="Enter your password again" secureTextEntry autoComplete="new-password" editable={!busy} onSubmitEditing={submit} />}
        {step === "credentials" && mfa && <Input label="AUTHENTICATOR OR RECOVERY CODE" value={code} onChangeText={setCode} placeholder="6-digit code or recovery code" autoCapitalize="characters" autoCorrect={false} maxLength={32} editable={!busy} onSubmitEditing={submit} />}
        {step === "authenticator" && totpSetup && <Card style={styles.authenticatorCard}><Text style={styles.authenticatorTitle}>Set up your authenticator app</Text><Text style={styles.authenticatorCopy}>In your authenticator, add an account with this setup key. Keep it private.</Text><Text selectable style={styles.authenticatorSecret}>{totpSetup.secret}</Text><Text style={styles.authenticatorCopy}>Then enter the current 6-digit code below.</Text><Input label="6-DIGIT CODE" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" keyboardType="number-pad" maxLength={6} editable={!busy} onSubmitEditing={submit} /></Card>}
        {step === "recoveryCodes" && <Card style={styles.recoveryCodesCard}><Text selectable style={styles.recoveryCodes}>{recoveryCodes.join("\n")}</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: codesSaved }} onPress={() => setCodesSaved((saved) => !saved)} style={styles.recoverySavedRow}><View style={[styles.consentCheck, codesSaved && styles.consentCheckOn]}>{codesSaved && <Ionicons name="checkmark" size={15} color="white" />}</View><Text style={styles.recoverySavedText}>I saved these recovery codes somewhere private.</Text></Pressable></Card>}
        {!!error && <Notice text={error} />}
        <ActionButton title={step === "authenticator" ? "Verify authenticator" : step === "recoveryCodes" ? "Continue to Sophia" : mfa ? "Verify and sign in" : signup ? "Create account" : "Sign in"} icon="arrow-forward" onPress={submit} busy={busy} disabled={step === "recoveryCodes" && !codesSaved} />
        {step === "credentials" && mfa && <Pressable onPress={() => { setMfa(false); setCode(""); setError(""); }} style={styles.textAction}><Text style={styles.textActionLabel}>Use a different account</Text></Pressable>}
        {step === "credentials" && !mfa && <Pressable disabled={busy} onPress={() => changeMode(!signup)} style={styles.textAction}><Text style={styles.textActionLabel}>{signup ? "Already have an account? Sign in" : "New to Sophia? Create an account"}</Text></Pressable>}
        {step === "authenticator" && <Pressable disabled={busy} onPress={() => { setStep("credentials"); setTotpSetup(null); setCode(""); setError(signup ? "Your account is not active yet. Sign up again when you’re ready to finish setup." : "Sign in again when you’re ready to finish authenticator setup."); }} style={styles.textAction}><Text style={styles.textActionLabel}>{signup ? "Cancel account setup" : "Back to sign in"}</Text></Pressable>}
      </View>
      {step === "credentials" && <View style={styles.loginFoot}><Ionicons name="lock-closed-outline" size={15} color={C.green} /><Text style={styles.loginFootText}>Your account is protected with two-step verification.</Text></View>}
      </KeyboardAvoidingView>
    </ScrollView>
  </SafeAreaView>;
}

function ScrollPage({ children, refreshing, onRefresh, contentStyle }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; contentStyle?: object }) {
  return <ScrollView contentContainerStyle={[styles.pageContent, contentStyle]} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.purple} colors={[C.purple]} /> : undefined}>{children}</ScrollView>;
}

function Today({ cookie, profile, onAsk, onPlan }: { cookie: string; profile: SessionUser; onAsk: () => void; onPlan: () => void }) {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [error, setError] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [toast, setToast] = useState("");
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    const [briefResult, taskResult] = await Promise.allSettled([api.dailyBrief(cookie), api.tasks(cookie)]);
    if (briefResult.status === "fulfilled") setBrief(briefResult.value);
    else if (!(briefResult.reason instanceof ApiError && briefResult.reason.status === 402)) setError(message(briefResult.reason));
    if (taskResult.status === "fulfilled") setTasks(taskResult.value.tasks.filter((task) => task.status === "OPEN"));
    else setError(message(taskResult.reason));
    setLoading(false); setRefreshing(false);
  }, [cookie]);
  useEffect(() => { void load(); }, [load]);
  async function prepareBrief() {
    setBriefBusy(true); setError("");
    try { setBrief(await api.generateBrief(cookie)); }
    catch (e) { setError(e instanceof ApiError && e.code === "daily_brief_plan" ? "Daily Brief is included with a Team plan." : message(e)); }
    finally { setBriefBusy(false); }
  }
  async function addTask() {
    const title = taskDraft.trim(); if (!title) return;
    setSavingTask(true);
    try { await api.createTask(cookie, title); setTaskDraft(""); setShowTask(false); setToast("Added to your plan"); void load(true); }
    catch (e) { setError(message(e)); }
    finally { setSavingTask(false); }
  }
  const firstName = profile.displayName?.trim().split(/\s+/)[0] || profile.username;
  return <ScrollPage refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }}>
    <FadeIn>
      <View style={styles.dateLine}><Eyebrow color={C.purple}>{dateLabel().toLocaleUpperCase()}</Eyebrow><View style={styles.todayDot} /></View>
      <Text style={styles.todayGreeting}>{greeting()},</Text><Text style={styles.todayName}>{firstName}.</Text>
      <Text style={styles.todayIntro}>Let’s make space for what matters today.</Text>
      <View style={styles.todayActions}>
        <Pressable accessibilityRole="button" onPress={onAsk} style={({ pressed }) => [styles.askCard, pressed && { opacity: 0.9 }]}>
          <View style={styles.askOrb}><Ionicons name="sparkles" size={19} color={C.purple} /></View><View style={{ flex: 1 }}><Text style={styles.askTitle}>Ask Sophia</Text><Text style={styles.askSubtitle}>Think something through</Text></View><Ionicons name="arrow-up" size={17} color={C.purple} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onPlan} style={({ pressed }) => [styles.quickStat, pressed && { opacity: 0.9 }]}><Text style={styles.quickStatNum}>{tasks.length}</Text><Text style={styles.quickStatLabel}>open{`\n`}tasks</Text></Pressable>
      </View>

      <View style={styles.sectionHead}><View><Eyebrow>TODAY, IN FOCUS</Eyebrow><Text style={styles.sectionTitle}>Your brief</Text></View>{brief?.brief?.mode === "live" && <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>PERSONALIZED</Text></View>}</View>
      {loading ? <Card><LoadingLine label="Putting your day together" /></Card> : brief?.brief ? <Card style={styles.briefCard}>
        <View style={styles.briefTop}><View style={styles.briefIcon}><Ionicons name="sunny-outline" size={17} color={C.purple} /></View><Text style={styles.briefDate}>{new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(brief.brief.localDate + "T12:00:00"))}</Text><Text style={styles.briefCount}>{brief.brief.meetings.length} {brief.brief.meetings.length === 1 ? "meeting" : "meetings"}</Text></View>
        <Text style={styles.briefNarrative}>{brief.brief.narrative}</Text>
        {!!brief.brief.meetings.length && <View style={styles.briefItems}>{brief.brief.meetings.slice(0, 3).map((meeting) => <View key={meeting.id} style={styles.briefItem}><View style={styles.meetingTime}><Text style={styles.meetingTimeText}>{prettyTime(meeting.startsAt)}</Text></View><View style={{ flex: 1 }}><Text style={styles.briefItemTitle}>{meeting.title}</Text>{!!meeting.prepNote && <Text numberOfLines={2} style={styles.briefItemMeta}>{meeting.prepNote}</Text>}</View></View>)}</View>}
        {!!brief.brief.needsReply.length && <View style={styles.briefSubsection}><Eyebrow>NEEDS YOUR ATTENTION</Eyebrow>{brief.brief.needsReply.slice(0, 2).map((item) => <View key={item.id} style={styles.attentionRow}><View style={[styles.priorityDot, item.urgency === "high" && { backgroundColor: C.amber }]} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.briefItemTitle}>{item.subject}</Text><Text style={styles.briefItemMeta}>{item.fromAddress} · {item.reason}</Text></View></View>)}</View>}
        {!!brief.brief.actions.length && <View style={styles.approvalNote}><Ionicons name="hand-left-outline" size={15} color={C.amber} /><Text style={styles.approvalText}>Sophia can draft suggestions; sending or changing events always waits for your approval.</Text></View>}
      </Card> : <Card style={styles.briefEmpty}>
        <View style={styles.briefIcon}><Ionicons name="calendar-outline" size={17} color={C.purple} /></View>
        <Text style={styles.emptyBriefTitle}>{brief?.pendingReason === "before_brief_time" ? "Your day is still ahead" : "A clearer start, whenever you want it"}</Text>
        <Text style={styles.emptyBriefCopy}>{brief?.pendingReason === "not_connected" ? "Connect a calendar or email to give Sophia context for your day." : "Prepare a brief from your connected calendar and email."}</Text>
        <ActionButton title="Prepare my brief" icon="sparkles" onPress={prepareBrief} busy={briefBusy} />
      </Card>}

      {brief?.brief?.overdueFollowUps?.length ? <View style={styles.followupCard}><View style={styles.followupHead}><Ionicons name="time-outline" size={16} color={C.amber} /><Text style={styles.followupTitle}>Follow-ups to revisit</Text></View>{brief.brief.overdueFollowUps.slice(0, 2).map((item) => <Text key={item.id} style={styles.followupText}>{item.subject} · {item.daysOverdue}d overdue</Text>)}</View> : null}

      <View style={styles.sectionHead}><View><Eyebrow>ONE STEP AT A TIME</Eyebrow><Text style={styles.sectionTitle}>Your priorities</Text></View><Pressable onPress={onPlan} hitSlop={10}><Text style={styles.seeAll}>See all</Text></Pressable></View>
      {loading ? <Card><LoadingLine label="Loading priorities" /></Card> : tasks.length ? <Card style={{ paddingVertical: 5 }}>{tasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} cookie={cookie} onChanged={() => void load(true)} />)}</Card> : <Card><EmptyState icon="checkmark-done-outline" title="A little breathing room" detail="You’re clear for now. Add a task whenever something comes to mind." action={<Pressable onPress={() => setShowTask(true)} style={styles.emptyAction}><Text style={styles.emptyActionText}>Add a task</Text></Pressable>} /></Card>}
      {showTask && <View style={styles.taskComposer}><Input autoFocus label="ADD A PRIORITY" value={taskDraft} onChangeText={setTaskDraft} placeholder="What would you like to remember?" returnKeyType="done" onSubmitEditing={addTask} /><View style={styles.composerButtons}><Pressable onPress={() => setShowTask(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable><ActionButton title="Add task" icon="add" onPress={addTask} busy={savingTask} disabled={!taskDraft.trim()} /></View></View>}
      {!showTask && <Pressable style={styles.inlineAdd} onPress={() => setShowTask(true)}><Ionicons name="add-circle-outline" size={20} color={C.purple} /><Text style={styles.inlineAddText}>Add a priority</Text></Pressable>}
      {toast ? <Notice text={toast} tone="success" /> : null}{!!error && <Notice text={error} />}
    </FadeIn>
  </ScrollPage>;
}

function TaskRow({ task, cookie, onChanged }: { task: Task; cookie: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try { await api.updateTask(cookie, task.id, task.status === "DONE" ? "OPEN" : "DONE"); onChanged(); }
    catch (e) { Alert.alert("Couldn’t update this task", message(e)); }
    finally { setBusy(false); }
  }
  return <View style={styles.taskRow}>
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.status === "DONE" }} accessibilityLabel={`Mark ${task.title} ${task.status === "DONE" ? "open" : "done"}`} onPress={toggle} disabled={busy} style={[styles.checkButton, task.status === "DONE" && styles.checkButtonDone]}>{busy ? <ActivityIndicator size="small" color={C.purple} /> : task.status === "DONE" ? <Ionicons name="checkmark" size={14} color="white" /> : null}</Pressable>
    <View style={{ flex: 1 }}><Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]}>{task.title}</Text>{task.dueAt ? <Text style={styles.taskDue}>{prettyTime(task.dueAt)}{task.source === "RADAR" ? " · suggested" : ""}</Text> : task.source === "RADAR" ? <Text style={styles.taskDue}>Suggested by Sophia</Text> : null}</View>
    {task.source === "RADAR" && <Ionicons name="sparkles-outline" size={15} color={C.purple} />}
  </View>;
}

function Inbox({ cookie, onOpen }: { cookie: string; onOpen: (conversation: Conversation) => void }) {
  const colors = useColors();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showPeople, setShowPeople] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setRows((await api.conversations(cookie)).conversations); }
    catch (e) { setError(message(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [cookie]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!rows.length || !isUnlocked()) return;
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const row of rows.slice(0, 40)) {
        try {
          const recent = await conversationPlaintext(row.id, 1);
          const last = recent[recent.length - 1];
          if (last) next[row.id] = messagePreviewText(last.plaintext);
        } catch {
          next[row.id] = t("encryptedPreview");
        }
      }
      if (alive) setPreviews(next);
    })();
    return () => { alive = false; };
  }, [rows]);
  return <View style={[styles.fill, { backgroundColor: colors.bg }]}>
    <ScrollPage refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} contentStyle={styles.inboxPage}>
      <FadeIn><Heading title="Your people." subtitle="A quieter place for the conversations that matter." right={<RoundAction icon="create-outline" accessibilityLabel="Start a conversation" active onPress={() => setShowPeople(true)} />} />
        <View style={styles.encryptionCallout}><Ionicons name="lock-closed" size={16} color={C.green} /><Text style={styles.encryptionCopy}>Private conversations are end-to-end encrypted. Only you and the people in them can read messages.</Text></View>
        {loading ? <InboxSkeleton /> : error ? <Notice text={error} /> : rows.length ? <View style={[styles.conversationList, { backgroundColor: colors.paper, borderColor: colors.line }]}>{rows.map((row) => <ConversationRow key={row.id} conversation={row} preview={previews[row.id]} onPress={() => onOpen(row)} />)}</View> : <Card><EmptyState icon="chatbubbles-outline" title="Your inbox starts here" detail="Find someone you trust and start a private conversation." action={<Pressable accessibilityRole="button" style={styles.emptyAction} onPress={() => setShowPeople(true)}><Text style={styles.emptyActionText}>Find someone</Text></Pressable>} /></Card>}
        <Text style={styles.inboxFootnote}>Messages are encrypted on your device before they leave it.</Text>
      </FadeIn>
    </ScrollPage>
    <PeopleSheet visible={showPeople} cookie={cookie} onClose={() => setShowPeople(false)} onOpen={(row) => { setShowPeople(false); onOpen(row); void load(); }} />
  </View>;
}

function InboxSkeleton() {
  const colors = useColors();
  return <View style={[styles.conversationList, { backgroundColor: colors.paper, borderColor: colors.line }]}>
    {Array.from({ length: 6 }, (_, index) => <View key={index} style={styles.conversationRow}>
      <View style={[styles.skeletonAvatar, { backgroundColor: colors.lilac }]} />
      <View style={styles.conversationCopy}>
        <View style={[styles.skeletonLine, { width: "46%", backgroundColor: colors.lilac }]} />
        <View style={[styles.skeletonLine, { width: "78%", backgroundColor: colors.line }]} />
      </View>
    </View>)}
  </View>;
}

function ConversationRow({ conversation, preview, onPress }: { conversation: Conversation; preview?: string; onPress: () => void }) {
  const colors = useColors();
  const name = conversationName(conversation);
  const group = conversation.type === "GROUP";
  const subtitle = preview || (group ? "Family & team space" : conversation.peer?.username ? `@${conversation.peer.username}` : "Private conversation");
  return <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress} style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}>
    <Avatar title={name} group={group} size={52} />
    <View style={styles.conversationCopy}><View style={styles.conversationTitleRow}><Text numberOfLines={1} style={[styles.conversationTitle, { color: colors.ink }]}>{name}</Text><Text style={[styles.conversationTime, { color: colors.faint }]}>{conversation.lastMessageAt ? prettyTime(conversation.lastMessageAt) : ""}</Text></View>
      <View style={styles.conversationSubRow}><Text style={[styles.conversationSubtitle, { color: colors.muted }]} numberOfLines={1}>{subtitle}</Text>{!!conversation.unreadCount && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</Text></View>}</View>
    </View>
  </Pressable>;
}

function PeopleSheet({ visible, cookie, onClose, onOpen }: { visible: boolean; cookie: string; onClose: () => void; onOpen: (conversation: Conversation) => void }) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<User[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<User[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState("");
  useEffect(() => {
    if (!visible || query.trim().length < 2) { setPeople([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      api.lookupPeople(cookie, query.trim()).then((result) => { if (live) setPeople(result.users); })
        .catch((caught) => { if (live) setError(message(caught)); }).finally(() => { if (live) setBusy(false); });
    }, 260);
    return () => { live = false; clearTimeout(timer); };
  }, [cookie, query, visible]);
  async function start(user: User) {
    setStarting(user.id); setError("");
    try { onOpen(await api.createDirect(cookie, user.username)); }
    catch (e) { setError(message(e)); }
    finally { setStarting(""); }
  }
  function toggleGroupMember(user: User) {
    setSelectedPeople((current) => current.some((item) => item.id === user.id)
      ? current.filter((item) => item.id !== user.id)
      : current.length < 7 ? [...current, user] : current);
  }
  async function createGroup() {
    if (selectedPeople.length < 2) return;
    setStarting("group"); setError("");
    try {
      const conversation = await api.createGroup(cookie, {
        memberUserIds: selectedPeople.map((person) => person.id),
        ...(groupTitle.trim() ? { title: groupTitle.trim() } : {}),
      });
      onOpen(conversation);
    } catch (e) { setError(message(e)); }
    finally { setStarting(""); }
  }
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.sheetScrim}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" /><View style={styles.sheet}>
      <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Eyebrow>MAKE A CONNECTION</Eyebrow><Text style={styles.sheetTitle}>Find your people</Text></View><RoundAction icon="close" accessibilityLabel="Close search" onPress={onClose} /></View>
      <View style={styles.groupModeRow}>{(["direct", "group"] as const).map((choice) => <Pressable key={choice} onPress={() => { setMode(choice); setError(""); }} style={[styles.groupModeButton, mode === choice && styles.groupModeButtonActive]}><Ionicons name={choice === "direct" ? "person-outline" : "people-outline"} size={15} color={mode === choice ? C.purple : C.muted} /><Text style={[styles.groupModeText, mode === choice && styles.groupModeTextActive]}>{choice === "direct" ? "One to one" : "Group chat"}</Text></Pressable>)}</View>
      {mode === "group" && <Input value={groupTitle} onChangeText={setGroupTitle} placeholder="Group name (optional)" maxLength={80} />}
      <Input autoFocus value={query} onChangeText={setQuery} placeholder="Search by name or username" autoCapitalize="none" returnKeyType="search" />
      <View style={{ minHeight: 210, marginTop: 16 }}>
        {busy ? <LoadingLine label="Finding people" /> : error ? <Notice text={error} /> : query.trim().length < 2 ? <Text style={styles.searchHint}>{mode === "group" ? "Choose at least two people. Groups can have up to eight members including you." : "Enter at least two characters to search."}</Text> : people.length ? people.map((person) => {
          const selected = selectedPeople.some((item) => item.id === person.id);
          return <Pressable key={person.id} onPress={() => mode === "group" ? toggleGroupMember(person) : void start(person)} style={styles.personRow}>
          <Avatar title={person.displayName || person.username} size={45} /><View style={{ flex: 1 }}><Text style={styles.personName}>{person.displayName || person.username}</Text><Text style={styles.personUsername}>@{person.username}</Text></View>{mode === "group" ? <View style={[styles.memberCheck, selected && styles.memberCheckOn]}>{selected && <Ionicons name="checkmark" size={15} color="white" />}</View> : starting === person.id ? <ActivityIndicator color={C.purple} /> : <Ionicons name="arrow-forward-circle-outline" size={23} color={C.purple} />}
        </Pressable>;
        }) : <Text style={styles.searchHint}>No one found yet. Check the spelling and try again.</Text>}
      </View>
      {mode === "group" && <View style={styles.groupCreateFooter}><Text style={styles.selectedCount}>{selectedPeople.length}/7 people selected</Text><ActionButton title="Create encrypted group" icon="arrow-forward" onPress={() => void createGroup()} busy={starting === "group"} disabled={selectedPeople.length < 2} /></View>}
    </View></View>
  </Modal>;
}

function Plan({ cookie }: { cookie: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"OPEN" | "DONE">("OPEN");
  const load = useCallback(async () => {
    setError("");
    try { setTasks((await api.tasks(cookie)).tasks); } catch (e) { setError(message(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [cookie]);
  useEffect(() => { void load(); }, [load]);
  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try { await api.createTask(cookie, draft.trim()); setDraft(""); await load(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const visible = tasks.filter((task) => task.status === filter);
  return <ScrollPage refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }}>
    <FadeIn><Heading title="A plan that breathes." subtitle="Keep the next right thing within reach." />
      <Card style={styles.planInput}><Input value={draft} onChangeText={setDraft} placeholder="What’s on your mind? Add a task…" returnKeyType="done" onSubmitEditing={add} /><Pressable accessibilityRole="button" disabled={!draft.trim() || busy} onPress={add} style={[styles.sendTask, (!draft.trim() || busy) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="white" /> : <Ionicons name="arrow-up" size={19} color="white" />}</Pressable></Card>
      {!!error && <Notice text={error} />}
      <View style={styles.filterRow}>{(["OPEN", "DONE"] as const).map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.filterChipActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === "OPEN" ? "To do" : "Completed"}</Text><Text style={[styles.filterCount, filter === value && styles.filterTextActive]}>{tasks.filter((task) => task.status === value).length}</Text></Pressable>)}</View>
      {loading ? <Card><LoadingLine label="Loading your plan" /></Card> : visible.length ? <Card style={{ paddingVertical: 5 }}>{visible.map((task) => <TaskRow key={task.id} task={task} cookie={cookie} onChanged={() => void load()} />)}</Card> : <Card><EmptyState icon={filter === "OPEN" ? "leaf-outline" : "checkmark-done-outline"} title={filter === "OPEN" ? "Nothing pressing" : "Nothing completed yet"} detail={filter === "OPEN" ? "Add a task above; it will be here when you need it." : "Finished tasks will gather here."} /></Card>}
      <View style={styles.planHint}><Ionicons name="sparkles-outline" color={C.purple} size={16} /><Text style={styles.planHintText}>Ask Sophia to help turn a big intention into smaller next steps.</Text></View>
    </FadeIn>
  </ScrollPage>;
}

function Spaces({ cookie, myUserId, onOpenConversation }: { cookie: string; myUserId: string; onOpenConversation: (conversation: Conversation) => void }) {
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [newInvite, setNewInvite] = useState<{ code: string; path: string } | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [memberSearchBusy, setMemberSearchBusy] = useState(false);
  const [memberNotice, setMemberNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [kind, setKind] = useState<Workspace["kind"]>("FAMILY");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const selected = spaces.find((space) => space.id === selectedId) ?? null;
  const canInvite = selected?.role === "OWNER" || selected?.role === "ADMIN";
  const addableMemberResults = memberResults.filter((person) =>
    !members.some((member) => member.userId === person.id),
  );

  const load = useCallback(async (preferredId?: string) => {
    setError("");
    try {
      const result = await api.workspaces(cookie);
      setSpaces(result.workspaces);
      setSelectedId((current) => preferredId ?? (current && result.workspaces.some((space) => space.id === current) ? current : result.workspaces[0]?.id ?? null));
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [cookie]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const result = await api.workspaceDetail(cookie, id);
      setSpaces((current) => current.map((space) => space.id === id ? result.workspace : space));
      setMembers(result.members);
      setInvites(result.invites);
    } catch (e) { setError(message(e)); }
    finally { setDetailLoading(false); }
  }, [cookie]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setNewInvite(null);
    setSelectedMemberIds([]);
    setMemberSearch("");
    setMemberResults([]);
    setMemberNotice("");
    if (selectedId) void loadDetail(selectedId);
    else { setMembers([]); setInvites([]); }
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const query = memberSearch.trim();
    if (!canInvite || query.length < 2) {
      setMemberResults([]);
      setMemberSearchBusy(false);
      return;
    }
    let active = true;
    setMemberResults([]);
    setMemberSearchBusy(true);
    const timer = setTimeout(() => {
      void api.lookupPeople(cookie, query)
        .then((result) => { if (active) setMemberResults(result.users); })
        .catch((caught) => { if (active) setError(message(caught)); })
        .finally(() => { if (active) setMemberSearchBusy(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [canInvite, cookie, memberSearch]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.createWorkspace(cookie, name.trim(), kind);
      setName(""); setCreating(false); setSelectedId(result.workspace.id);
      await load(result.workspace.id);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function createInvite() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const result = await api.createWorkspaceInvite(cookie, selected.id);
      setNewInvite(result.invite);
      await Share.share({ message: `Join ${selected.name} on Sophia:\n${WEB_URL}${result.invite.path}` });
      await loadDetail(selected.id);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function revokeInvite(inviteId: string) {
    if (!selected) return;
    setBusy(true); setError("");
    try { await api.revokeWorkspaceInvite(cookie, selected.id, inviteId); await loadDetail(selected.id); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function startDirect(member: WorkspaceMember) {
    if (!selected) return;
    setBusy(true); setError("");
    try { onOpenConversation(await api.workspaceDirect(cookie, selected.id, member.username)); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function addWorkspaceMember(person: User) {
    if (!selected) return;
    setBusy(true);
    setError("");
    setMemberNotice("");
    try {
      await api.addWorkspaceMember(cookie, selected.id, person.username);
      setMemberSearch("");
      setMemberResults([]);
      setMemberNotice(`Added ${person.displayName || `@${person.username}`} to ${selected.name}.`);
      await Promise.all([loadDetail(selected.id), load(selected.id)]);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function startGroup() {
    if (!selected || selectedMemberIds.length === 0) return;
    setBusy(true); setError("");
    try {
      onOpenConversation(await api.workspaceGroup(cookie, selected.id, {
        memberUserIds: selectedMemberIds,
        ...(groupTitle.trim() ? { title: groupTitle.trim() } : {}),
      }));
      setSelectedMemberIds([]); setGroupTitle("");
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  function toggleGroupMember(userId: string) {
    setError("");
    setSelectedMemberIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId);
      if (current.length >= 8) {
        setError("A group chat can include up to 8 other people from this space.");
        return current;
      }
      return [...current, userId];
    });
  }

  return <ScrollPage refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); if (selectedId) void loadDetail(selectedId); }}>
    <FadeIn><Heading title="Your circles." subtitle="Family and work, with room for both." right={<RoundAction icon="add" accessibilityLabel="Create a space" onPress={() => setCreating(!creating)} active />} />
      {!!error && <Notice text={error} />}
      {creating && <Card style={styles.createSpaceCard}><Eyebrow>START A SHARED SPACE</Eyebrow><Input label="NAME" value={name} onChangeText={setName} placeholder={kind === "FAMILY" ? "The Qumsieh family" : "Studio team"} />
        <View style={styles.kindRow}>{(["FAMILY", "TEAM"] as const).map((choice) => <Pressable key={choice} onPress={() => setKind(choice)} style={[styles.kindOption, kind === choice && styles.kindOptionActive]}><Ionicons name={choice === "FAMILY" ? "home-outline" : "briefcase-outline"} size={16} color={kind === choice ? C.purple : C.muted} /><Text style={[styles.kindLabel, kind === choice && { color: C.purple }]}>{choice === "FAMILY" ? "Family" : "Team"}</Text></Pressable>)}</View>
        <ActionButton title="Create space" icon="arrow-forward" onPress={create} busy={busy} disabled={!name.trim()} />
      </Card>}
      {loading ? <Card><LoadingLine label="Loading your spaces" /></Card> : spaces.length ? <View style={{ gap: 9 }}>{spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityState={{ selected: space.id === selectedId }} onPress={() => setSelectedId(space.id)} style={[styles.spaceCard, space.id === selectedId && styles.spaceCardSelected]}>
        <View style={styles.spaceTop}><View style={styles.spaceIcon}><Ionicons name={space.kind === "FAMILY" ? "home" : "briefcase"} size={18} color={C.purple} /></View><View style={{ flex: 1 }}><Text style={styles.spaceName}>{space.name}</Text><Text style={styles.spaceMeta}>{space.kind === "FAMILY" ? "Family" : "Team"} · {space.role.toLowerCase()}</Text></View><Ionicons name={space.id === selectedId ? "checkmark-circle" : "chevron-forward"} size={18} color={space.id === selectedId ? C.purple : C.faint} /></View>
        <View style={styles.spaceDivider} /><View style={styles.spaceBottom}><Text style={styles.spaceMeta}>{space.seatCount}{space.seatLimit ? ` / ${space.seatLimit}` : ""} people</Text><Text style={styles.spaceMeta}>{space.dailyBrief ? "Daily Brief included" : "Private conversations"}</Text></View>
      </Pressable>)}</View> : <Card><EmptyState icon="people-outline" title="Good things, together" detail="Create a family or team space to coordinate and start private conversations." action={<ActionButton title="Create a space" icon="add" onPress={() => setCreating(true)} secondary />} /></Card>}

      {selected && <Card style={styles.workspaceDetailCard}>
        <View style={styles.workspaceDetailHeading}><View style={{ flex: 1 }}><Eyebrow>{selected.kind === "FAMILY" ? "FAMILY SPACE" : "TEAM WORKSPACE"}</Eyebrow><Text style={styles.workspaceDetailName}>{selected.name}</Text><Text style={styles.spaceMeta}>{selected.seatCount} of {selected.seatLimit || "unlimited"} seats · {selected.role.toLowerCase()}</Text></View>{canInvite && <RoundAction icon="person-add-outline" accessibilityLabel="Invite people" onPress={() => void createInvite()} active />}</View>
        {newInvite && <View style={styles.workspaceInviteNotice}><Text style={styles.workspaceInviteTitle}>Invite ready to share</Text><Text selectable style={styles.workspaceInviteLink}>{WEB_URL}{newInvite.path}</Text><Text style={styles.workspaceInviteHint}>This link contains a one-time invite. Share it with the person joining this space.</Text></View>}
        {canInvite && <ActionButton title="Create and share invite" icon="share-outline" onPress={() => void createInvite()} busy={busy} secondary />}
        {canInvite && <View style={styles.workspaceAddMembers}>
          <Eyebrow>ADD AN EXISTING SOPHIA MEMBER</Eyebrow>
          <Input label="NAME OR USERNAME" value={memberSearch} onChangeText={setMemberSearch} placeholder="Search people by name" autoCapitalize="none" autoCorrect={false} />
          {!!memberNotice && <Text accessibilityRole="alert" style={styles.workspaceMemberNotice}>{memberNotice}</Text>}
          {memberSearch.trim().length === 1 && <Text style={styles.spaceMeta}>Type at least 2 characters to search.</Text>}
          {memberSearchBusy && <LoadingLine label="Searching people" />}
          {!memberSearchBusy && memberSearch.trim().length >= 2 && addableMemberResults.length === 0 && <Text style={styles.spaceMeta}>No new Sophia accounts found.</Text>}
          {addableMemberResults.map((person) => <View key={person.id} style={styles.workspaceAddMemberRow}>
            <Avatar title={person.displayName || person.username} size={36} />
            <View style={{ flex: 1 }}><Text style={styles.workspaceMemberName}>{person.displayName || person.username}</Text><Text style={styles.spaceMeta}>@{person.username}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add ${person.displayName || person.username} to ${selected.name}`} disabled={busy} onPress={() => void addWorkspaceMember(person)} style={[styles.workspaceMessageButton, busy && { opacity: 0.5 }]}>
              <Ionicons name="person-add-outline" size={16} color={C.purple} /><Text style={styles.workspaceMessageLabel}>Add</Text>
            </Pressable>
          </View>)}
        </View>}
        {detailLoading ? <LoadingLine label="Loading members" /> : <>
          <View style={styles.workspaceSectionHead}><Text style={styles.workspaceSectionTitle}>Members</Text><Text style={styles.spaceMeta}>{members.length}</Text></View>
          <Text style={styles.workspaceHelp}>Tap a member to include them in a group chat. Use Message for a private 1:1 chat.</Text>
          {members.map((member) => {
            const isMe = member.userId === myUserId;
            const selectedForGroup = selectedMemberIds.includes(member.userId);
            return <View key={member.userId} style={styles.workspaceMemberRow}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedForGroup }} disabled={isMe} onPress={() => toggleGroupMember(member.userId)} style={styles.workspaceMemberSelect}>
                <View style={[styles.memberCheck, selectedForGroup && styles.memberCheckOn]}>{selectedForGroup && <Ionicons name="checkmark" size={14} color="white" />}</View>
                <Avatar title={member.displayName || member.username} size={38} />
                <View style={{ flex: 1 }}><Text style={styles.workspaceMemberName}>{member.displayName || member.username}{isMe ? " · you" : ""}</Text><Text style={styles.spaceMeta}>@{member.username} · {member.role.toLowerCase()}</Text></View>
              </Pressable>
              {!isMe && <Pressable accessibilityRole="button" accessibilityLabel={`Message ${member.displayName || member.username}`} disabled={busy} onPress={() => void startDirect(member)} style={styles.workspaceMessageButton}><Ionicons name="chatbubble-ellipses-outline" size={17} color={C.purple} /><Text style={styles.workspaceMessageLabel}>Message</Text></Pressable>}
            </View>;
          })}
          {selectedMemberIds.length > 0 && <View style={styles.workspaceGroupComposer}><Input label="GROUP NAME (OPTIONAL)" value={groupTitle} onChangeText={setGroupTitle} placeholder="A name for this conversation" maxLength={80} /><ActionButton title={`Start group chat · ${selectedMemberIds.length + 1}`} icon="chatbubbles-outline" onPress={() => void startGroup()} busy={busy} /></View>}
        </>}
        {canInvite && invites.some((invite) => !invite.revokedAt && !invite.consumedAt && Date.parse(invite.expiresAt) > Date.now()) && <View style={styles.workspaceInvites}>
          <Text style={styles.workspaceSectionTitle}>Pending invites</Text>
          {invites.filter((invite) => !invite.revokedAt && !invite.consumedAt && Date.parse(invite.expiresAt) > Date.now()).map((invite) => <View key={invite.id} style={styles.workspaceInviteRow}><Text style={styles.spaceMeta}>Code ending {invite.hint} · expires {new Date(invite.expiresAt).toLocaleDateString()}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void revokeInvite(invite.id)}><Text style={styles.revokeInviteLabel}>Revoke</Text></Pressable></View>)}
        </View>}
      </Card>}
    </FadeIn>
  </ScrollPage>;
}

function You({ profile, onSignOut, onAsk, onTools }: { profile: SessionUser; onSignOut: () => void; onAsk: () => void; onTools: () => void }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { await onSignOut(); } finally { setBusy(false); }
  }
  return <ScrollPage>
    <FadeIn><Heading title="A space that’s yours." subtitle="Your account, privacy, and Sophia." />
      <Card style={styles.profileCard}><Avatar title={profile.displayName || profile.username} size={62} />
        <View style={{ flex: 1 }}><Text style={styles.profileName}>{profile.displayName || profile.username}</Text><Text style={styles.profileHandle}>@{profile.username}</Text></View>
        <View style={styles.verifiedMark}><Ionicons name="shield-checkmark" size={17} color={C.green} /></View>
      </Card>
      <Eyebrow>YOUR SOPHIA</Eyebrow>
      <Pressable style={styles.settingRow} onPress={onAsk}><View style={[styles.settingIcon,{backgroundColor:C.lilac}]}><Ionicons name="sparkles-outline" size={18} color={C.purple} /></View><View style={{flex:1}}><Text style={styles.settingTitle}>Cloud Sophia</Text><Text style={styles.settingMeta}>Consent and personal context</Text></View><Ionicons name="chevron-forward" size={17} color={C.faint} /></Pressable>
      <Pressable style={styles.settingRow} onPress={() => Alert.alert("Your privacy", "Sophia stores encrypted message content. Your message text stays on your devices; the server routes encrypted envelopes.")}><View style={[styles.settingIcon,{backgroundColor:C.greenWash}]}><Ionicons name="lock-closed-outline" size={18} color={C.green} /></View><View style={{flex:1}}><Text style={styles.settingTitle}>Privacy & security</Text><Text style={styles.settingMeta}>End-to-end encrypted conversations</Text></View><Ionicons name="chevron-forward" size={17} color={C.faint} /></Pressable>
      <LockDelayRow />
      <Pressable style={styles.settingRow} onPress={onTools}><View style={[styles.settingIcon,{backgroundColor:C.amberWash}]}><Ionicons name="link-outline" size={18} color={C.amber} /></View><View style={{flex:1}}><Text style={styles.settingTitle}>Connected tools</Text><Text style={styles.settingMeta}>Calendar, email, work apps</Text></View><Ionicons name="chevron-forward" size={17} color={C.faint} /></Pressable>
      <Card style={styles.deviceInfo}><Ionicons name="phone-portrait-outline" size={17} color={C.muted} /><Text style={styles.deviceInfoText}>This app is signed in with a protected session. Message keys are set up separately on this device when you open a conversation.</Text></Card>
      <ActionButton title="Sign out" icon="log-out-outline" onPress={() => void signOut()} busy={busy} secondary />
      <Text style={styles.versionText}>Sophia Mobile · Connected to Sophia securely</Text>
    </FadeIn>
  </ScrollPage>;
}

function LockDelayRow() {
  const [delay, setDelay] = useState<LockDelayMs>(currentLockDelayMs());
  useEffect(() => {
    void loadLockDelayMs().then(setDelay).catch(() => undefined);
  }, []);
  const label = delay === 0 ? t("lockImmediate") : delay === 30_000 ? t("lock30") : t("lock60");
  function choose(next: LockDelayMs) {
    setDelay(next);
    void saveLockDelayMs(next).catch(() => undefined);
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={t("lockTitle")} style={styles.settingRow} onPress={() => Alert.alert(t("lockTitle"), t("lockHelp"), [
    { text: t("lockImmediate"), onPress: () => choose(0) },
    { text: t("lock30"), onPress: () => choose(30_000) },
    { text: t("lock60"), onPress: () => choose(60_000) },
    { text: t("cancel"), style: "cancel" },
  ])}><View style={[styles.settingIcon, { backgroundColor: C.lilac }]}><Ionicons name="time-outline" size={18} color={C.purple} /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>{t("lockTitle")}</Text><Text style={styles.settingMeta}>{label}</Text></View><Ionicons name="chevron-forward" size={17} color={C.faint} /></Pressable>;
}

function AskSophia({ cookie }: { cookie: string }) {
  const [active, setActive] = useState<boolean | null>(null);
  const [purpose, setPurpose] = useState(CONSENT_PURPOSE);
  const [version, setVersion] = useState(CONSENT_VERSION);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.cloudConsent(cookie).then((consent) => { if (live) { setActive(consent.active); setPurpose(consent.purposeText); setVersion(consent.versionId); } })
      .catch((e) => { if (live) setError(message(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [cookie]);
  async function grant() {
    setBusy(true); setError("");
    try { await api.grantCloudConsent(cookie, purpose, version); setActive(true); setChecked(false); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function ask() {
    if (!prompt.trim()) return;
    setBusy(true); setError(""); setReply("");
    try { setReply((await api.completeCloudSophia(cookie, prompt.trim())).reply); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <ScrollPage contentStyle={{ paddingBottom: 28 }}><FadeIn>
    <View style={styles.assistantHero}><View style={styles.assistantOrb}><Ionicons name="sparkles" size={24} color={C.purple} /></View><Eyebrow color={C.purple}>YOUR PERSONAL CHIEF OF STAFF</Eyebrow><Text style={styles.assistantTitle}>Let’s think it through.</Text><Text style={styles.assistantIntro}>A place to untangle the day, plan your next move, or find a little clarity.</Text></View>
    {loading ? <Card><LoadingLine label="Checking your privacy settings" /></Card> : active ? <>
      <View style={styles.cloudNotice}><Ionicons name="cloud-outline" size={17} color={C.purple} /><Text style={styles.cloudNoticeText}>Your prompt and connected calendar, mail, and work metadata may be sent to Sophia’s cloud model. Encrypted chat history is not automatically included; text you paste into a prompt is sent.</Text></View>
      <Card style={styles.askForm}><Input label="WHAT’S ON YOUR MIND?" value={prompt} onChangeText={setPrompt} placeholder="I have a busy day tomorrow. Help me find a good place to start…" multiline textAlignVertical="top" style={styles.promptInput} maxLength={7000} />
        <View style={styles.askFormBottom}><Text style={styles.charCount}>{prompt.length}/7000</Text><ActionButton title="Ask Sophia" icon="arrow-up" onPress={ask} busy={busy} disabled={!prompt.trim()} /></View>
      </Card>
      {!!reply && <Card style={styles.replyCard}><View style={styles.replyTitleRow}><View style={styles.replyIcon}><Ionicons name="sparkles" size={14} color={C.purple} /></View><Text style={styles.replyTitle}>A thought from Sophia</Text></View><Text style={styles.replyText}>{reply}</Text></Card>}
    </> : <Card style={styles.consentCard}>
      <View style={styles.consentHeader}><View style={styles.consentIcon}><Ionicons name="shield-checkmark-outline" size={18} color={C.purple} /></View><Text style={styles.consentTitle}>Your context stays your choice</Text></View>
      <Text style={styles.consentCopy}>Cloud Sophia can use your prompt and connected calendar, email, and work metadata to give a more useful answer. Your encrypted conversations are not automatically sent.</Text>
      <View style={styles.purposeBox}><Eyebrow>WHAT YOU’RE ALLOWING</Eyebrow><Text style={styles.purposeText}>{purpose}</Text></View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked(!checked)} style={styles.consentCheckRow}><View style={[styles.consentCheck, checked && styles.consentCheckOn]}>{checked && <Ionicons name="checkmark" size={14} color="white" />}</View><Text style={styles.consentCheckText}>I understand and want to enable Cloud Sophia.</Text></Pressable>
      <ActionButton title="Enable Cloud Sophia" icon="arrow-forward" onPress={grant} busy={busy} disabled={!checked} />
      <Text style={styles.consentFoot}>You can withdraw this permission in Settings at any time.</Text>
    </Card>}
    {!!error && <Notice text={error} />}
    <Card style={styles.localNote}><Ionicons name="phone-portrait-outline" size={17} color={C.green} /><View style={{flex:1}}><Text style={styles.localNoteTitle}>Encrypted chats stay out of cloud context</Text><Text style={styles.localNoteCopy}>Your private message text is never added to this assistant’s context automatically.</Text></View></Card>
  </FadeIn></ScrollPage>;
}

function NativeChat({ conversation, cookie }: { conversation: Conversation; cookie: string }) {
  return <NativeThread conversation={conversation} cookie={cookie} />;
}

function NativeWebPage({ path }: { path: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const url = useMemo(() => `${WEB_URL}${path}`, [path]);
  const retryChat = useCallback(() => { setError(""); setLoaded(false); setRetry((n) => n + 1); }, []);
  const allowed = useCallback((value: string) => {
    try { const host = new URL(value).hostname; return value.startsWith("https://") && [new URL(WEB_URL).hostname, new URL(API_URL).hostname, "accounts.google.com", "login.microsoftonline.com", "github.com", "linear.app", "slack.com"].includes(host); }
    catch { return false; }
  }, []);
  return <View style={styles.chatRoot}>
    <NativeWebView key={retry} source={{ uri: url }} style={styles.webview} originWhitelist={["https://*"]} javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled allowsBackForwardNavigationGestures setSupportMultipleWindows={false} applicationNameForUserAgent="SophiaMobile/1.0"
      onShouldStartLoadWithRequest={(request: { url: string }) => { if (allowed(request.url)) return true; if (/^(mailto:|tel:)/i.test(request.url)) { void Linking.openURL(request.url).catch(() => undefined); return false; } if (request.url.startsWith("https://")) void Linking.openURL(request.url).catch(() => undefined); return false; }}
      onLoad={() => { setLoaded(true); setError(""); }}
      onError={({ nativeEvent }: { nativeEvent: { description: string } }) => setError(nativeEvent.description || "Couldn’t load this conversation.")}
      onHttpError={({ nativeEvent }: { nativeEvent: { isForMainFrame?: boolean; statusCode: number } }) => { if (nativeEvent.isForMainFrame !== false && nativeEvent.statusCode >= 500) setError("Sophia is temporarily unavailable. Your messages remain safe."); }}
      onContentProcessDidTerminate={retryChat} onRenderProcessGone={retryChat} />
    {!loaded && !error && <View style={styles.chatLoading} pointerEvents="none"><ActivityIndicator color={C.purple} /><Text style={styles.chatLoadingText}>Opening your encrypted conversation</Text></View>}
    {!!error && <View style={styles.chatError}><Notice text={error} /><ActionButton title="Try again" icon="refresh" onPress={retryChat} secondary /></View>}
  </View>;
}


const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, center: { alignItems: "center", justifyContent: "center" }, fill: { flex: 1 }, main: { flex: 1 },
  authScrollContent: { flexGrow: 1 }, authenticatorCard: { gap: 12, padding: 14 }, authenticatorTitle: { color: C.ink, fontSize: 14, fontWeight: "700" }, authenticatorCopy: { color: C.muted, fontSize: 12, lineHeight: 18 }, authenticatorSecret: { color: C.purple, backgroundColor: C.lilac, borderRadius: 12, padding: 13, textAlign: "center", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", letterSpacing: 1 }, recoveryCodesCard: { gap: 14, padding: 15 }, recoveryCodes: { color: C.ink, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 24, textAlign: "center" }, recoverySavedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }, recoverySavedText: { color: C.ink, fontSize: 12, lineHeight: 18, flex: 1 },
  appHeader: { minHeight: 59, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 }, brandMark: { width: 30, height: 30, borderRadius: 11, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" }, brandLetter: { color: "white", fontFamily: "Georgia", fontStyle: "italic", fontSize: 22, marginTop: -2 }, brandLarge: { color: C.ink, fontFamily: "Georgia", fontSize: 25, letterSpacing: -0.6 }, headerWordmark: { color: C.ink, fontFamily: "Georgia", fontSize: 20, letterSpacing: -0.5, marginLeft: 1, marginRight: "auto" }, profileButton: { marginLeft: "auto", padding: 3 }, profileImage: { width: 36, height: 36, borderRadius: 13 }, subpageTitle: { color: C.ink, fontSize: 15, fontWeight: "700", flex: 1, textAlign: "center" },
  securePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.greenWash, paddingHorizontal: 9, minHeight: 32, borderRadius: 20 }, securePillText: { color: C.green, fontSize: 10, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  skeletonAvatar: { width: 52, height: 52, borderRadius: 18 },
  skeletonLine: { height: 10, borderRadius: 6 },
  tabBar: { minHeight: 67, flexDirection: "row", backgroundColor: "#FFFEFC", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingHorizontal: 6, paddingTop: 5, paddingBottom: Platform.OS === "ios" ? 1 : 6 }, tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 56 }, tabIcon: { height: 29, minWidth: 51, borderRadius: 15, alignItems: "center", justifyContent: "center" }, tabIconActive: { backgroundColor: C.lilac }, tabText: { color: C.muted, fontSize: 10, fontWeight: "600" }, tabTextActive: { color: C.purple, fontWeight: "700" },
  startupLabel: { color: C.muted, fontSize: 13, marginTop: 14 }, loginScreen: { flex: 1, justifyContent: "center", paddingHorizontal: 27, paddingBottom: 30 }, loginTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 41, lineHeight: 47, letterSpacing: -1.5, marginTop: 13 }, loginCopy: { color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 12, maxWidth: 290 }, loginForm: { gap: 17, marginTop: 30 }, loginFoot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 27 }, loginFootText: { color: C.muted, fontSize: 11 }, textAction: { alignItems: "center", padding: 10 }, textActionLabel: { color: C.purple, fontSize: 13, fontWeight: "600" },
  pageContent: { paddingHorizontal: 22, paddingTop: 25, paddingBottom: 34, gap: 14 }, dateLine: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 17 }, todayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green }, todayGreeting: { color: C.ink, fontFamily: "Georgia", fontSize: 31, lineHeight: 38, letterSpacing: -0.8 }, todayName: { color: C.purple, fontFamily: "Georgia", fontSize: 36, lineHeight: 43, letterSpacing: -1.1 }, todayIntro: { color: C.muted, fontSize: 14, marginTop: 4 },
  todayActions: { flexDirection: "row", gap: 11, marginTop: 22 }, askCard: { flex: 1, minHeight: 80, padding: 14, borderRadius: 20, backgroundColor: C.lilac, borderWidth: 1, borderColor: C.lilac2, flexDirection: "row", alignItems: "center", gap: 10 }, askOrb: { width: 40, height: 40, borderRadius: 14, backgroundColor: "white", alignItems: "center", justifyContent: "center" }, askTitle: { color: C.ink, fontSize: 14, fontWeight: "700" }, askSubtitle: { color: C.muted, fontSize: 11, marginTop: 4 }, quickStat: { minWidth: 84, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: "white", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, quickStatNum: { color: C.purple, fontFamily: "Georgia", fontSize: 26 }, quickStatLabel: { color: C.muted, fontSize: 10, lineHeight: 13 },
  sectionHead: { marginTop: 30, marginBottom: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, sectionTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 22, marginTop: 5 }, liveBadge: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: C.greenWash }, liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.green }, liveText: { color: C.green, fontSize: 8, fontWeight: "800", letterSpacing: 0.6 }, seeAll: { color: C.purple, fontSize: 12, fontWeight: "700", paddingBottom: 3 },
  briefCard: { padding: 17 }, briefTop: { flexDirection: "row", alignItems: "center", gap: 8 }, briefIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center" }, briefDate: { color: C.ink, fontSize: 12, fontWeight: "700", flex: 1 }, briefCount: { color: C.muted, fontSize: 10 }, briefNarrative: { color: C.ink, fontSize: 13, lineHeight: 20, marginTop: 15 }, briefItems: { marginTop: 13, borderTopWidth: 1, borderTopColor: C.line }, briefItem: { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingTop: 12 }, meetingTime: { width: 47 }, meetingTimeText: { color: C.purple, fontSize: 11, fontWeight: "700", paddingTop: 1 }, briefItemTitle: { color: C.ink, fontSize: 12, fontWeight: "700" }, briefItemMeta: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 3 }, briefSubsection: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 14, paddingTop: 13, gap: 12 }, attentionRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, priorityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.purple, marginTop: 4 }, approvalNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: C.amberWash, borderRadius: 12, padding: 11, marginTop: 14 }, approvalText: { flex: 1, color: "#8C652E", fontSize: 10, lineHeight: 15 }, briefEmpty: { padding: 18, alignItems: "flex-start" }, emptyBriefTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 17, marginTop: 13 }, emptyBriefCopy: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 16 }, followupCard: { backgroundColor: C.amberWash, borderRadius: 16, padding: 13, gap: 8 }, followupHead: { flexDirection: "row", alignItems: "center", gap: 7 }, followupTitle: { color: "#875C29", fontSize: 12, fontWeight: "700" }, followupText: { color: "#8C652E", fontSize: 11 },
  taskRow: { minHeight: 61, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }, checkButton: { width: 23, height: 23, borderRadius: 8, borderWidth: 1.5, borderColor: C.lilac2, alignItems: "center", justifyContent: "center" }, checkButtonDone: { backgroundColor: C.green, borderColor: C.green }, taskTitle: { color: C.ink, fontSize: 13, fontWeight: "600" }, taskTitleDone: { color: C.muted, textDecorationLine: "line-through" }, taskDue: { color: C.muted, fontSize: 10, marginTop: 4 }, inlineAdd: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 }, inlineAddText: { color: C.purple, fontSize: 12, fontWeight: "700" }, emptyAction: { marginTop: 14, paddingVertical: 7 }, emptyActionText: { color: C.purple, fontSize: 13, fontWeight: "700" }, taskComposer: { padding: 15, backgroundColor: C.lilac, borderRadius: 18, gap: 13 }, composerButtons: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, cancelText: { color: C.muted, fontSize: 13, padding: 9 },
  inboxPage: { paddingTop: 26 }, encryptionCallout: { flexDirection: "row", gap: 9, padding: 13, borderRadius: 15, backgroundColor: C.greenWash, marginBottom: 17 }, encryptionCopy: { color: C.green, fontSize: 11, lineHeight: 16, flex: 1 }, conversationList: { backgroundColor: "white", borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 13 }, conversationRow: { flexDirection: "row", alignItems: "center", minHeight: 76, gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, paddingVertical: 11 }, rowPressed: { opacity: 0.68 }, conversationCopy: { flex: 1, gap: 7 }, conversationTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, conversationTitle: { color: C.ink, fontSize: 14, fontWeight: "700", flex: 1 }, conversationTime: { color: C.faint, fontSize: 9 }, conversationSubRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, conversationSubtitle: { color: C.muted, fontSize: 11, flex: 1 }, unreadBadge: { minWidth: 21, height: 21, paddingHorizontal: 5, borderRadius: 11, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" }, unreadText: { color: "white", fontSize: 10, fontWeight: "700" }, inboxFootnote: { color: C.faint, fontSize: 10, textAlign: "center", marginTop: 17 },
  sheetScrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(35,31,44,0.32)" }, sheet: { minHeight: "53%", maxHeight: "90%", paddingHorizontal: 23, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 30 : 22, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.lilac2, alignSelf: "center", marginBottom: 18 }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }, sheetTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 23, marginTop: 4 }, searchHint: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: "center", paddingTop: 30 }, personRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }, personName: { color: C.ink, fontSize: 13, fontWeight: "700" }, personUsername: { color: C.muted, fontSize: 11, marginTop: 3 },
  groupModeRow: { flexDirection: "row", gap: 8, marginBottom: 13 }, groupModeButton: { minHeight: 37, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, flex: 1 }, groupModeButtonActive: { backgroundColor: C.lilac, borderColor: C.lilac2 }, groupModeText: { color: C.muted, fontSize: 11, fontWeight: "600" }, groupModeTextActive: { color: C.purple }, memberCheck: { width: 22, height: 22, borderRadius: 8, borderWidth: 1.5, borderColor: C.lilac2, alignItems: "center", justifyContent: "center" }, memberCheckOn: { backgroundColor: C.purple, borderColor: C.purple }, groupCreateFooter: { paddingTop: 12, gap: 8 }, selectedCount: { color: C.muted, fontSize: 11, textAlign: "center" },
  filterRow: { flexDirection: "row", gap: 8, marginVertical: 5 }, filterChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: "white" }, filterChipActive: { backgroundColor: C.lilac, borderColor: C.lilac2 }, filterText: { color: C.muted, fontSize: 11, fontWeight: "600" }, filterTextActive: { color: C.purple }, filterCount: { color: C.faint, fontSize: 10 }, planInput: { flexDirection: "row", alignItems: "center", gap: 9, padding: 10 }, sendTask: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" }, planHint: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 13, backgroundColor: C.lilac, borderRadius: 14, marginTop: 4 }, planHintText: { flex: 1, color: C.purple, fontSize: 11, lineHeight: 16 },
  createSpaceCard: { gap: 14 }, kindRow: { flexDirection: "row", gap: 9 }, kindOption: { flex: 1, minHeight: 43, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: "white", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, kindOptionActive: { backgroundColor: C.lilac, borderColor: C.lilac2 }, kindLabel: { color: C.muted, fontSize: 12, fontWeight: "600" }, spaceCard: { marginBottom: 2, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, spaceCardSelected: { borderColor: C.lilac2, backgroundColor: "#FBF9FF" }, spaceTop: { flexDirection: "row", alignItems: "center", gap: 12 }, spaceIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center" }, spaceName: { color: C.ink, fontSize: 14, fontWeight: "700" }, spaceMeta: { color: C.muted, fontSize: 10, marginTop: 4 }, spaceDivider: { height: 1, backgroundColor: C.line, marginVertical: 13 }, spaceBottom: { flexDirection: "row", justifyContent: "space-between" },
  workspaceDetailCard: { marginTop: 12, gap: 14 }, workspaceDetailHeading: { flexDirection: "row", alignItems: "center", gap: 12 }, workspaceDetailName: { color: C.ink, fontFamily: "Georgia", fontSize: 23, marginTop: 5 }, workspaceSectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }, workspaceSectionTitle: { color: C.ink, fontSize: 13, fontWeight: "700" }, workspaceHelp: { color: C.muted, fontSize: 11, lineHeight: 16, marginTop: -8 }, workspaceAddMembers: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 13 }, workspaceAddMemberRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 9 }, workspaceMemberNotice: { color: C.green, fontSize: 11, lineHeight: 16 }, workspaceMemberRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingVertical: 7 }, workspaceMemberSelect: { flex: 1, minHeight: 45, flexDirection: "row", alignItems: "center", gap: 9 }, workspaceMemberName: { color: C.ink, fontSize: 12, fontWeight: "600" }, workspaceMessageButton: { minHeight: 38, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.lilac, flexDirection: "row", alignItems: "center", gap: 5 }, workspaceMessageLabel: { color: C.purple, fontSize: 10, fontWeight: "700" }, workspaceGroupComposer: { gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 13 }, workspaceInviteNotice: { backgroundColor: C.amberWash, borderRadius: 14, padding: 12, gap: 7 }, workspaceInviteTitle: { color: "#805820", fontSize: 12, fontWeight: "700" }, workspaceInviteLink: { color: C.ink, fontSize: 11, lineHeight: 17 }, workspaceInviteHint: { color: "#805820", fontSize: 10, lineHeight: 15 }, workspaceInvites: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 13, gap: 10 }, workspaceInviteRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, revokeInviteLabel: { color: C.red, fontSize: 11, fontWeight: "700", padding: 6 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 26 }, profileName: { color: C.ink, fontSize: 15, fontWeight: "700" }, profileHandle: { color: C.muted, fontSize: 11, marginTop: 4 }, verifiedMark: { width: 31, height: 31, borderRadius: 12, backgroundColor: C.greenWash, alignItems: "center", justifyContent: "center" }, settingRow: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, flexDirection: "row", alignItems: "center", gap: 12 }, settingIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" }, settingTitle: { color: C.ink, fontSize: 13, fontWeight: "700" }, settingMeta: { color: C.muted, fontSize: 10, marginTop: 4 }, deviceInfo: { marginTop: 18, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F0EFF1" }, deviceInfoText: { color: C.muted, fontSize: 11, lineHeight: 16, flex: 1 }, versionText: { textAlign: "center", color: C.faint, fontSize: 10, paddingVertical: 15 }, hidden: { display: "none" },
  assistantHero: { alignItems: "center", paddingTop: 8, paddingBottom: 17 }, assistantOrb: { width: 53, height: 53, borderRadius: 19, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center", marginBottom: 18 }, assistantTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 29, textAlign: "center", marginTop: 9 }, assistantIntro: { color: C.muted, fontSize: 13, lineHeight: 19, maxWidth: 290, textAlign: "center", marginTop: 8 }, cloudNotice: { backgroundColor: C.lilac, borderRadius: 15, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 13 }, cloudNoticeText: { color: C.purple, flex: 1, fontSize: 10, lineHeight: 15 }, askForm: { padding: 14 }, promptInput: { minHeight: 122, lineHeight: 21, paddingTop: 12 }, askFormBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }, charCount: { color: C.faint, fontSize: 10 }, replyCard: { marginTop: 13 }, replyTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, replyIcon: { width: 25, height: 25, borderRadius: 9, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center" }, replyTitle: { color: C.ink, fontSize: 12, fontWeight: "700" }, replyText: { color: C.ink, fontSize: 13, lineHeight: 21, marginTop: 13 }, consentCard: { gap: 15 }, consentHeader: { flexDirection: "row", alignItems: "center", gap: 10 }, consentIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center" }, consentTitle: { color: C.ink, fontSize: 14, fontWeight: "700", flex: 1 }, consentCopy: { color: C.muted, fontSize: 12, lineHeight: 19 }, purposeBox: { padding: 13, borderRadius: 14, backgroundColor: "#F2F0F3", gap: 8 }, purposeText: { color: C.ink, fontSize: 11, lineHeight: 17 }, consentCheckRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }, consentCheck: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: C.lilac2, alignItems: "center", justifyContent: "center" }, consentCheckOn: { backgroundColor: C.purple, borderColor: C.purple }, consentCheckText: { flex: 1, color: C.ink, fontSize: 11, lineHeight: 16 }, consentFoot: { textAlign: "center", color: C.faint, fontSize: 10 }, localNote: { marginTop: 13, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: C.greenWash }, localNoteTitle: { color: C.green, fontSize: 11, fontWeight: "700" }, localNoteCopy: { color: C.green, fontSize: 10, lineHeight: 15, marginTop: 4 },
  chatRoot: { flex: 1, backgroundColor: "white" }, chatNotice: { minHeight: 36, backgroundColor: C.greenWash, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 }, chatNoticeText: { color: C.green, fontSize: 10, fontWeight: "600" }, webview: { flex: 1, backgroundColor: "white" }, chatLoading: { ...StyleSheet.absoluteFill, top: 36, alignItems: "center", justifyContent: "center", backgroundColor: "white" }, chatLoadingText: { color: C.muted, fontSize: 12, marginTop: 12 }, chatError: { ...StyleSheet.absoluteFill, top: 36, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 15, padding: 26 },
});
