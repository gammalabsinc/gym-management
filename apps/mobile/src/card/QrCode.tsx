import { StyleSheet, View } from "react-native";
import { qrMatrix } from "./qr";

const styles = StyleSheet.create({
  frame: { backgroundColor: "#FFFFFF", padding: 12, alignSelf: "center" },
  row: { flexDirection: "row" },
});

/** Black modules on a white square with a quiet zone, whatever the brand colour is. */
export function QrCode(props: { readonly value: string; readonly size?: number }) {
  const rows = qrMatrix(props.value);
  const cell = Math.floor((props.size ?? 220) / rows.length);
  return (
    <View
      accessibilityLabel="QR code of your member barcode"
      accessibilityRole="image"
      style={styles.frame}
    >
      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          {row.modules.map((module) => (
            <View
              key={module.key}
              style={{
                width: cell,
                height: cell,
                backgroundColor: module.dark ? "#000000" : "#FFFFFF",
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
