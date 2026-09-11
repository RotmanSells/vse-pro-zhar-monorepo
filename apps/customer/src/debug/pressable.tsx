import { useCallback } from "react";
import { Pressable as NativePressable, type PressableProps } from "react-native";

import { debugError, debugLog } from "./logger";

export function LoggedPressable(props: PressableProps): React.JSX.Element {
  const { onPress, accessibilityLabel, accessibilityRole, disabled } = props;
  const handlePress = useCallback<NonNullable<PressableProps["onPress"]>>((event) => {
    const startedAt = Date.now();
    debugLog("ui.press.start", {
      label: accessibilityLabel ?? "unlabeled",
      role: typeof accessibilityRole === "string" ? accessibilityRole : null,
      disabled: disabled === true
    });
    try {
      onPress?.(event);
      debugLog("ui.press.finish", { label: accessibilityLabel ?? "unlabeled", durationMs: Date.now() - startedAt });
    } catch (error: unknown) {
      debugError("ui.press.error", error, { label: accessibilityLabel ?? "unlabeled", durationMs: Date.now() - startedAt });
      throw error;
    }
  }, [accessibilityLabel, accessibilityRole, disabled, onPress]);

  return <NativePressable {...props} onPress={onPress === undefined ? undefined : handlePress} />;
}
