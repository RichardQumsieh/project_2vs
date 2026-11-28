import { useColorScheme } from "react-native";

export type Palette = {
  scheme: "light" | "dark";
  statusBar: "dark-content" | "light-content";
  bg: string;
  paper: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  purple: string;
  purpleDark: string;
  lilac: string;
  lilac2: string;
  green: string;
  greenWash: string;
  amber: string;
  amberWash: string;
  red: string;
  redWash: string;
  mine: string;
  mineInk: string;
  scrim: string;
};

export const lightPalette: Palette = {
  scheme: "light",
  statusBar: "dark-content",
  bg: "#F7F6F2",
  paper: "#FFFFFF",
  ink: "#272433",
  muted: "#898592",
  faint: "#ABA7B1",
  line: "#ECE9EF",
  purple: "#6D55A5",
  purpleDark: "#57418B",
  lilac: "#F0ECF7",
  lilac2: "#E6DFF0",
  green: "#4E806B",
  greenWash: "#E9F2EC",
  amber: "#B97835",
  amberWash: "#F8EFE1",
  red: "#A65058",
  redWash: "#F8EAEB",
  mine: "#6D55A5",
  mineInk: "#FFFFFF",
  scrim: "rgba(35,31,44,0.42)",
};

export const darkPalette: Palette = {
  scheme: "dark",
  statusBar: "light-content",
  bg: "#141218",
  paper: "#1E1B24",
  ink: "#F4F1EA",
  muted: "#B7B1C2",
  faint: "#8E8798",
  line: "#2F2A38",
  purple: "#C4B0F0",
  purpleDark: "#A992DE",
  lilac: "#2A2438",
  lilac2: "#3A3150",
  green: "#8FCBB0",
  greenWash: "#1C2E26",
  amber: "#E2B56A",
  amberWash: "#2E2618",
  red: "#E7A0A6",
  redWash: "#2E1C20",
  mine: "#6D55A5",
  mineInk: "#FFFFFF",
  scrim: "rgba(0,0,0,0.56)",
};

export function useColors() {
  return useColorScheme() === "dark" ? darkPalette : lightPalette;
}
