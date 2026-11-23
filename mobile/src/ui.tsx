import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

export const C = {
  bg: "#F7F6F2", paper: "#FFFFFF", ink: "#272433", muted: "#898592", faint: "#ABA7B1",
  line: "#ECE9EF", purple: "#6D55A5", purpleDark: "#57418B", lilac: "#F0ECF7", lilac2: "#E6DFF0",
  green: "#4E806B", greenWash: "#E9F2EC", amber: "#B97835", amberWash: "#F8EFE1", red: "#A65058", redWash: "#F8EAEB",
};

export function FadeIn({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(7)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 190, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 190, useNativeDriver: true }),
    ]).start();
  }, [opacity, y]);
  return <Animated.View style={[style, { opacity, transform: [{ translateY: y }] }]}>{children}</Animated.View>;
}

export function Eyebrow({ children, color = C.muted }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

export function Heading({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return <View style={styles.heading}>
    <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>
    {right}
  </View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ActionButton({ title, onPress, icon, disabled, busy, secondary }: {
  title: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; busy?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && !disabled && styles.buttonPressed, (disabled || busy) && styles.buttonDisabled]}>
    {busy ? <ActivityIndicator color={secondary ? C.purple : "white"} size="small" /> : <>
      {icon ? <Ionicons name={icon} size={17} color={secondary ? C.purple : "white"} /> : null}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </>}
  </Pressable>;
}

export function RoundAction({ icon, onPress, accessibilityLabel, active = false }: {
  icon: keyof typeof Ionicons.glyphMap; onPress: () => void; accessibilityLabel: string; active?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => [styles.roundAction, active && styles.roundActionActive, pressed && { opacity: 0.7 }]}>
    <Ionicons name={icon} size={19} color={active ? C.purple : C.ink} />
  </Pressable>;
}

export function Input({ label, style, ...props }: TextInputProps & { label?: string }) {
  return <View style={{ gap: 8 }}>
    {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
    <TextInput placeholderTextColor={C.faint} selectionColor={C.purple} style={[styles.input, style]} {...props} />
  </View>;
}

export function Notice({ text, tone = "error" }: { text: string; tone?: "error" | "info" | "success" }) {
  const color = tone === "error" ? C.red : tone === "success" ? C.green : C.purple;
  const background = tone === "error" ? C.redWash : tone === "success" ? C.greenWash : C.lilac;
  return <View accessibilityRole={tone === "error" ? "alert" : undefined} style={[styles.notice, { backgroundColor: background }]}>
    <Ionicons name={tone === "error" ? "alert-circle-outline" : tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"} color={color} size={18} />
    <Text style={[styles.noticeText, { color }]}>{text}</Text>
  </View>;
}

export function LoadingLine({ label = "Loading your space" }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator size="small" color={C.purple} /><Text style={styles.loadingText}>{label}</Text></View>;
}

export function EmptyState({ icon, title, detail, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; action?: React.ReactNode }) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Ionicons name={icon} size={22} color={C.purple} /></View>
    <Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text>{action}
  </View>;
}

export function Avatar({ title, size = 50, group = false }: { title: string; size?: number; group?: boolean }) {
  const initial = title.trim().charAt(0).toLocaleUpperCase() || "S";
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: group ? size / 2 : size * 0.36 }]}>
    {group ? <Ionicons name="people" size={size * 0.4} color={C.purple} /> : <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initial}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 10, lineHeight: 14, letterSpacing: 1.2, fontWeight: "700" },
  heading: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 22 },
  title: { color: C.ink, fontFamily: "Georgia", fontSize: 29, lineHeight: 35, letterSpacing: -0.6 },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  card: { backgroundColor: C.paper, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: C.line },
  button: { minHeight: 49, paddingHorizontal: 18, borderRadius: 15, backgroundColor: C.purple, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  buttonSecondary: { backgroundColor: C.lilac },
  buttonPressed: { backgroundColor: C.purpleDark },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "white", fontSize: 14, fontWeight: "700" },
  buttonTextSecondary: { color: C.purple },
  roundAction: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "white", borderWidth: 1, borderColor: C.line },
  roundActionActive: { backgroundColor: C.lilac, borderColor: C.lilac2 },
  inputLabel: { color: C.muted, fontSize: 10, letterSpacing: 1.05, fontWeight: "700" },
  input: { minHeight: 51, borderWidth: 1, borderColor: C.line, borderRadius: 15, backgroundColor: "white", paddingHorizontal: 15, color: C.ink, fontSize: 15 },
  notice: { flexDirection: "row", alignItems: "flex-start", padding: 13, borderRadius: 14, gap: 9 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 },
  loadingText: { color: C.muted, fontSize: 13 },
  empty: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 18 },
  emptyIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: C.lilac, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  emptyTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 18, textAlign: "center" },
  emptyDetail: { color: C.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7, maxWidth: 280 },
  avatar: { backgroundColor: C.lilac, alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.purple, fontFamily: "Georgia" },
});
