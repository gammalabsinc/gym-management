import { StyleSheet, Text, View } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  title: { fontSize: 22, fontWeight: "600" },
  note: { marginTop: 8, fontSize: 16 },
});

export function PlaceholderScreen(props: { readonly title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.note}>This screen is built in a later ticket.</Text>
    </View>
  );
}
