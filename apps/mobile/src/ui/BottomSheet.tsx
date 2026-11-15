import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "./tokens";

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: COLORS.scrim },
  sheet: {
    padding: SPACE.xl,
    gap: SPACE.md,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    backgroundColor: COLORS.surface,
  },
  title: { fontSize: 17, fontWeight: "700", color: COLORS.text },
  close: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
});

/** A sheet that slides up over a scrim. Back and the close control both call `onClose`. */
export function BottomSheet(props: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <Modal visible={props.visible} transparent onRequestClose={props.onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityLabel={props.title}>
          <Text accessibilityRole="header" style={styles.title}>
            {props.title}
          </Text>
          {props.children}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={props.onClose}
            style={styles.close}
          >
            <Text>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
