import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Polyline } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { getPhotoEditorDimensions } from "../../frontend/lib/photo-editor-utils";
import { readUriBytes } from "./media-io";
import { centeredCrop, rotatedSize, type CropAspect } from "./photo-edit-math";
import type { NativeMediaAsset } from "./prepare-chat-media";

type Stroke = { color: string; width: number; points: string };

const COLORS = ["#ff5d9e", "#ffffff", "#111827", "#f5c16c", "#7c5cbf"];
const CROPS: { id: CropAspect; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "square", label: "Square" },
  { id: "fourFive", label: "4:5" },
  { id: "wide", label: "16:9" },
];

type Props = {
  asset: NativeMediaAsset;
  onCancel: () => void;
  onSave: (asset: NativeMediaAsset, overlayCaption: string) => void;
};

export function NativePhotoEditor({ asset, onCancel, onSave }: Props) {
  const previewRef = useRef<unknown>(null);
  const [uri, setUri] = useState(asset.uri);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState<CropAspect>("original");
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(8);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [caption, setCaption] = useState("");

  async function applyFrame(nextRotation: number, nextCrop: CropAspect) {
    setBusy(true);
    setError("");
    try {
      const sourceWidth = asset.width ?? 1280;
      const sourceHeight = asset.height ?? 1280;
      const oriented = rotatedSize(sourceWidth, sourceHeight, nextRotation);
      const actions: ImageManipulator.Action[] = [];
      if (nextRotation % 360 !== 0) actions.push({ rotate: ((nextRotation % 360) + 360) % 360 });
      const frame = centeredCrop(oriented.width, oriented.height, nextCrop);
      if (frame) actions.push({ crop: frame });
      const dims = getPhotoEditorDimensions(frame?.width ?? oriented.width, frame?.height ?? oriented.height);
      actions.push({ resize: { width: dims.width } });
      const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setUri(result.uri);
      setRotation(nextRotation);
      setCrop(nextCrop);
      setStrokes([]);
      setDraftStroke(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not edit this photo.");
    } finally {
      setBusy(false);
    }
  }

  function appendPoint(x: number, y: number, start: boolean) {
    const point = `${Math.round(x)},${Math.round(y)}`;
    if (start) {
      setDraftStroke({ color, width: brush, points: point });
      return;
    }
    setDraftStroke((current) => current ? { ...current, points: `${current.points} ${point}` } : current);
  }

  const draw = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => appendPoint(event.x, event.y, true))
    .onUpdate((event) => appendPoint(event.x, event.y, false))
    .onFinalize(() => {
      setDraftStroke((current) => {
        if (current) setStrokes((strokes) => [...strokes, current]);
        return null;
      });
    });

  async function save() {
    setBusy(true);
    setError("");
    try {
      let savedUri = uri;
      if (previewRef.current && (strokes.length > 0 || caption.trim() || draftStroke)) {
        try {
          savedUri = await (captureRef as (target: unknown, options: { format: "jpg"; quality: number; result: "tmpfile" }) => Promise<string>)(previewRef.current, { format: "jpg", quality: 0.85, result: "tmpfile" });
        } catch {
          savedUri = uri;
        }
      }
      const bytes = await readUriBytes(savedUri);
      onSave({
        uri: savedUri,
        bytes,
        mime: "image/jpeg",
        fileName: asset.fileName?.replace(/\.\w+$/, ".jpg") || "photo.jpg",
        width: asset.width,
        height: asset.height,
      }, caption.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the edited photo.");
      setBusy(false);
    }
  }

  const visible = draftStroke ? [...strokes, draftStroke] : strokes;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel photo edit" onPress={onCancel} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit photo</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Save photo" disabled={busy} onPress={() => void save()} style={styles.headerBtn}>
            {busy ? <ActivityIndicator color="#C4B5FD" /> : <Text style={[styles.headerBtnText, styles.save]}>Save</Text>}
          </Pressable>
        </View>
        <View ref={(node) => { previewRef.current = node; }} collapsable={false} style={styles.previewWrap}>
          <Image source={{ uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="Photo preview" />
          <GestureDetector gesture={draw}>
            <View style={styles.drawLayer} accessibilityLabel="Draw on photo">
              <Svg style={StyleSheet.absoluteFill as never}>
                {visible.map((stroke, index) => (
                  <Polyline
                    key={`${index}-${stroke.points.length}`}
                    points={stroke.points}
                    fill="none"
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </Svg>
            </View>
          </GestureDetector>
          {caption.trim() ? <Text style={styles.overlayCaption}>{caption}</Text> : null}
        </View>
        <View style={styles.tools}>
          {CROPS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: crop === item.id }}
              accessibilityLabel={`Crop ${item.label}`}
              disabled={busy}
              onPress={() => void applyFrame(rotation, item.id)}
              style={[styles.chip, crop === item.id && styles.chipOn]}
            >
              <Text style={styles.chipText}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Rotate photo" disabled={busy} onPress={() => void applyFrame(rotation + 90, crop)} style={styles.chip}>
            <Ionicons name="refresh" size={16} color="#E8ECF5" />
            <Text style={styles.chipText}>Rotate</Text>
          </Pressable>
        </View>
        <View style={styles.tools}>
          {COLORS.map((item) => (
            <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Paint color ${item}`} onPress={() => setColor(item)} style={[styles.swatch, { backgroundColor: item }, color === item && styles.swatchOn]} />
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Smaller brush" onPress={() => setBrush((size) => Math.max(3, size - 4))} style={styles.chip}>
            <Text style={styles.chipText}>Thin</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Larger brush" onPress={() => setBrush((size) => Math.min(28, size + 4))} style={styles.chip}>
            <Text style={styles.chipText}>Thick</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear drawing" onPress={() => { setStrokes([]); setDraftStroke(null); }} style={styles.chip}>
            <Text style={styles.chipText}>Clear</Text>
          </Pressable>
        </View>
        <TextInput
          value={caption}
          onChangeText={(value) => setCaption(value.slice(0, 140))}
          placeholder="Add a caption on the photo"
          placeholderTextColor="#8E95A8"
          style={styles.caption}
          accessibilityLabel="Photo caption"
          maxLength={140}
        />
        <Text style={styles.hint}>Rotate and crop reset drawings. Edits stay on this device until you send the encrypted photo.</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B0D12" },
  header: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: { minWidth: 64, minHeight: 36, justifyContent: "center" },
  headerBtnText: { color: "#D7DCE8", fontSize: 16 },
  save: { color: "#C4B5FD", fontWeight: "700", textAlign: "right" },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  previewWrap: { flex: 1, marginHorizontal: 12, borderRadius: 18, overflow: "hidden", backgroundColor: "#151821" },
  preview: { width: "100%", height: "100%" },
  drawLayer: { ...StyleSheet.absoluteFill },
  overlayCaption: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 16,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 6,
  },
  tools: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  chip: { minHeight: 36, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#1C2130", flexDirection: "row", alignItems: "center", gap: 6 },
  chipOn: { backgroundColor: "#3A2C63" },
  chipText: { color: "#E8ECF5", fontSize: 12, fontWeight: "600" },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "#2A3142" },
  swatchOn: { borderColor: "#FFFFFF", borderWidth: 2 },
  caption: { marginHorizontal: 16, marginTop: 10, minHeight: 42, borderRadius: 12, paddingHorizontal: 12, color: "#FFFFFF", backgroundColor: "#1C2130" },
  hint: { color: "#8E95A8", fontSize: 11, textAlign: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  error: { color: "#F5A8A8", textAlign: "center", paddingBottom: 12, paddingHorizontal: 16 },
});
