import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { withExternalActivity } from "./app-lock";
import { t } from "./i18n";
import { useColors } from "./theme";

type Props = {
  uri: string | null;
  mime?: string;
  onClose: () => void;
};

export function ImageViewer({ uri, mime, onClose }: Props) {
  const colors = useColors();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [notice, setNotice] = useState("");

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, saved.value * event.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value < 1.02) {
        scale.value = withTiming(1);
        saved.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      if (saved.value <= 1) return;
      translateX.value = savedX.value + event.translationX;
      translateY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });
  const gesture = Gesture.Simultaneous(pinch, pan);
  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  async function save() {
    if (!uri) return;
    setNotice("");
    try {
      const permission = await withExternalActivity(() => requestPermissionsAsync(true));
      if (!permission.granted) {
        setNotice(t("couldNotSave"));
        return;
      }
      await Asset.create(uri);
      setNotice(t("saved"));
    } catch {
      setNotice(t("couldNotSave"));
    }
  }

  async function share() {
    if (!uri) return;
    setNotice("");
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setNotice(t("couldNotShare"));
        return;
      }
      await withExternalActivity(() => Sharing.shareAsync(uri, { mimeType: mime || "image/jpeg" }));
    } catch {
      setNotice(t("couldNotShare"));
    }
  }

  return (
    <Modal visible={Boolean(uri)} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: "#0C0B10" }]}>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={onClose} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.toolbarActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("save")} onPress={() => void save()} style={styles.iconBtn}>
              <Ionicons name="download-outline" size={22} color="#FFFFFF" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("share")} onPress={() => void share()} style={styles.iconBtn}>
              <Ionicons name="share-outline" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.stage, imageStyle]}>
            {uri ? <Image source={{ uri }} style={styles.image} contentFit="contain" accessibilityLabel={t("photo")} /> : null}
          </Animated.View>
        </GestureDetector>
        {notice ? <Text style={[styles.notice, { color: colors.mineInk }]}>{notice}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { minHeight: 56, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toolbarActions: { flexDirection: "row", alignItems: "center" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  notice: { textAlign: "center", paddingBottom: 28, fontSize: 13 },
});
