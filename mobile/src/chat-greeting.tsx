import * as Speech from "expo-speech";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  parseAvatarConfig,
  parseGreetingAnimation,
  parseGreetingText,
  type AvatarPerson,
} from "../../frontend/lib/avatar/config";
import { createGreetingSession, prefersStaticAvatars, type Entrance } from "../../frontend/lib/avatar/greeting";
import { useAvatarPrefs } from "./avatar-prefs";
import { AvatarStage } from "./avatar-stage";

const session = createGreetingSession();

export function ChatGreeting({
  person,
  contactId,
  conversationId,
  isNew = false,
  size = 72,
}: {
  person?: AvatarPerson | null;
  contactId: string;
  conversationId?: string | null;
  isNew?: boolean;
  size?: number;
}) {
  const prefs = useAvatarPrefs();
  const [entrance, setEntrance] = useState<Entrance | null>(null);
  const [visible, setVisible] = useState(true);
  const spoken = useRef(false);
  useEffect(() => {
    let cancel = false;
    const frame = requestAnimationFrame(() => {
      if (cancel) return;
      setEntrance(session.enter({
        contactId,
        conversationId,
        isNew,
        hasAvatar: Boolean(parseAvatarConfig(person?.avatarConfig)),
        animation: parseGreetingAnimation(person?.greetingAnimation),
        text: parseGreetingText(person?.greetingText ?? null),
      }));
    });
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
    };
  }, [contactId, conversationId, isNew, person?.avatarConfig, person?.greetingAnimation, person?.greetingText]);
  useEffect(() => {
    if (!entrance) return;
    const timer = setTimeout(() => setVisible(false), isNew ? 7000 : 3600);
    return () => clearTimeout(timer);
  }, [entrance, isNew]);
  useEffect(() => {
    if (!entrance?.text || spoken.current || !prefs.speakGreetings) return;
    spoken.current = true;
    Speech.speak(entrance.text, { rate: 1 });
    return () => {
      Speech.stop();
    };
  }, [entrance, prefs.speakGreetings]);
  if (!entrance || !visible) return null;
  const staticAvatars = prefersStaticAvatars(prefs, false);
  return (
    <View style={{ alignItems: "center", paddingVertical: 12, gap: 8 }}>
      <AvatarStage
        person={person}
        size={size}
        animation={entrance.live && !staticAvatars ? entrance.animation : "idle"}
        playing={entrance.live && !staticAvatars}
      />
      {entrance.text ? (
        <View style={{ maxWidth: 260, backgroundColor: "#FFFFFF", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: "#272433", fontSize: 14 }}>{entrance.text}</Text>
        </View>
      ) : null}
    </View>
  );
}
