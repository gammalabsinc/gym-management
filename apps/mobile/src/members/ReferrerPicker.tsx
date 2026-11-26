import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useDebounced } from "../customers/useCustomers";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { COLORS, SPACE } from "../ui/tokens";
import type { MembersService, Referrer } from "./service";

export const REFERRER_SEARCH_DELAY_MS = 300;
export const REFERRER_SEARCH_FAILED = "We could not search members. Try again.";

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
  chosen: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  hint: { fontSize: 13, color: COLORS.textMuted },
  problem: { fontSize: 13, color: COLORS.danger },
  list: { gap: SPACE.sm },
});

type Found =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "found"; readonly people: readonly Referrer[] };

const label = (person: Referrer) => person.name ?? person.email;

/** Optional referred by, picked from a member search. Only the newest search can show its answer. */
export function ReferrerPicker(props: {
  readonly service: Pick<MembersService, "searchReferrers">;
  readonly value: Referrer | null;
  readonly onChange: (next: Referrer | null) => void;
}) {
  const [text, setText] = useState("");
  const term = useDebounced(text, REFERRER_SEARCH_DELAY_MS).trim();
  const [found, setFound] = useState<Found>({ status: "idle" });
  const generation = useRef(0);
  const { service } = props;

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    if (term === "") {
      setFound({ status: "idle" });
      return;
    }
    setFound({ status: "loading" });
    void service.searchReferrers(term).then((result) => {
      if (mine !== generation.current) return;
      setFound(
        result.status === "loaded"
          ? { status: "found", people: result.data }
          : { status: "failed" },
      );
    });
    return () => {
      generation.current += 1;
    };
  }, [service, term]);

  if (props.value !== null) {
    return (
      <View style={styles.chosen}>
        <View>
          <Text style={styles.label}>Referred by</Text>
          <Text style={styles.name}>{label(props.value)}</Text>
        </View>
        <Button label="Remove referrer" kind="secondary" onPress={() => props.onChange(null)} />
      </View>
    );
  }
  return (
    <View style={styles.list}>
      <TextField
        label="Referred by (optional)"
        value={text}
        onChangeText={setText}
        placeholder="Search name, email or number"
      />
      {found.status === "loading" ? <Text style={styles.hint}>Searching</Text> : null}
      {found.status === "failed" ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {REFERRER_SEARCH_FAILED}
        </Text>
      ) : null}
      {found.status === "found" && found.people.length === 0 ? (
        <Text style={styles.hint}>No one matches</Text>
      ) : null}
      {found.status === "found"
        ? found.people.map((person) => (
            <Button
              key={person.id}
              label={`Choose ${label(person)}`}
              kind="secondary"
              onPress={() => {
                props.onChange(person);
                setText("");
              }}
            />
          ))
        : null}
    </View>
  );
}
