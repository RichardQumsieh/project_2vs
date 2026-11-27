import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getPhotoEditorDimensions } from "../../frontend/lib/photo-editor-utils";
import { readUriBytes } from "./media-io";
import type { NativeMediaAsset } from "./prepare-chat-media";
import { C } from "./ui";

type Props = {
  asset: NativeMediaAsset;
  onCancel: () => void;
  onSave: (asset: NativeMediaAsset) => void;
};

export function NativePhotoEditor({ asset, onCancel, onSave }: Props) {
  const [uri, setUri] = useState(asset.uri);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotation, setRotation] = useState(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);

  async function apply(nextRotation = rotation, nextFlip = flipHorizontal) {
    setBusy(true);
    setError("");
    try {
      const actions: ImageManipulator.Action[] = [];
      if (nextRotation % 360 !== 0) {
        actions.push({ rotate: nextRotation % 360 });
      }
      if (nextFlip) {
        actions.push({ flip: ImageManipulator.FlipType.Horizontal });
      }
      const width = asset.width ?? 1280;
      const height = asset.height ?? 1280;
      const dims = getPhotoEditorDimensions(width, height);
      actions.push({ resize: { width: dims.width } });
      const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setUri(result.uri);
      setRotation(nextRotation);
      setFlipHorizontal(nextFlip);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not edit this photo.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const bytes = await readUriBytes(uri);
      onSave({
        uri,
        bytes,
        mime: "image/jpeg",
        fileName: asset.fileName?.replace(/\.\w+$/, ".jpg") || "photo.jpg",
        width: asset.width,
        height: asset.height,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the edited photo.");
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel photo edit" onPress={onCancel} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit photo</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Save photo" disabled={busy} onPress={() => void save()} style={styles.headerBtn}>
            {busy ? <ActivityIndicator color={C.purple} /> : <Text style={[styles.headerBtnText, styles.save]}>Save</Text>}
          </Pressable>
        </View>
        <View style={styles.previewWrap}>
          <Image source={{ uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="Photo preview" />
        </View>
        <View style={styles.tools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rotate photo"
            disabled={busy}
            style={styles.tool}
            onPress={() => void apply(rotation + 90, flipHorizontal)}
          >
            <Ionicons name="refresh" size={22} color="#E8ECF5" />
            <Text style={styles.toolLabel}>Rotate</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Flip photo"
            disabled={busy}
            style={styles.tool}
            onPress={() => void apply(rotation, !flipHorizontal)}
          >
            <Ionicons name="swap-horizontal" size={22} color="#E8ECF5" />
            <Text style={styles.toolLabel}>Flip</Text>
          </Pressable>
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B0D12" },
  header: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBtn: { minWidth: 64, minHeight: 36, justifyContent: "center" },
  headerBtnText: { color: "#D7DCE8", fontSize: 16 },
  save: { color: "#C4B5FD", fontWeight: "700", textAlign: "right" },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  previewWrap: { flex: 1, marginHorizontal: 12, borderRadius: 18, overflow: "hidden", backgroundColor: "#151821" },
  preview: { width: "100%", height: "100%" },
  tools: { flexDirection: "row", justifyContent: "center", gap: 28, paddingVertical: 22 },
  tool: { alignItems: "center", gap: 6, backgroundColor: "#1C2130", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
  toolLabel: { color: "#E8ECF5", fontSize: 12, fontWeight: "600" },
  error: { color: "#F5A8A8", textAlign: "center", paddingBottom: 18, paddingHorizontal: 16 },
});
