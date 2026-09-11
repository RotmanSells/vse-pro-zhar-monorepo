import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, TextInput, View } from "react-native";
import { LoggedPressable as Pressable } from "../debug/pressable";

import { formatRussianPhoneInput } from "@vse-pro-zhar/contracts";

export interface CustomerIdentifyValues {
  readonly phone: string;
}

export interface CustomerIdentifyModalProps {
  readonly visible: boolean;
  readonly busy?: boolean;
  readonly mode?: "add" | "checkout" | "loyalty" | "wheel" | "profile";
  readonly errorMessage: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (values: CustomerIdentifyValues) => Promise<boolean>;
}

export function CustomerIdentifyModal({
  visible,
  busy = false,
  mode = "add",
  errorMessage,
  onCancel,
  onSubmit
}: CustomerIdentifyModalProps): React.JSX.Element {
  const [phone, setPhone] = useState(() => formatRussianPhoneInput(""));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPhone(formatRussianPhoneInput(""));
      setValidationError(null);
      setSuccess(false);
    }
  }, [visible]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (phone.replace(/\D/gu, "").length !== 11) {
      setValidationError("Укажите номер телефона");
      return;
    }
    setValidationError(null);
    const saved = await onSubmit({ phone: phone.trim() });
    if (saved) setSuccess(true);
  };

  return (
    <Modal accessibilityViewIsModal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal testID="customer-identify-modal" style={styles.card}>
          {success ? (
            <>
              <Text style={styles.title}>Данные сохранены</Text>
              <Text style={styles.description}>
                {mode === "checkout"
                  ? "Профиль нужен, чтобы открыть проверку самовывоза."
                  : mode === "loyalty"
                    ? "Профиль нужен, чтобы показать только ваши подтверждённые XP и угольки."
                  : mode === "wheel"
                      ? "Профиль нужен, чтобы проверить завершённый оплаченный заказ и открыть рулетку."
                    : mode === "profile"
                      ? "Профиль нужен, чтобы показать только ваши данные, историю заказов и подтверждённую лояльность."
                  : "Товар добавлен в корзину."}
              </Text>
              <Pressable accessibilityRole="button" onPress={onCancel} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Продолжить</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {mode === "checkout"
                  ? "Заполните данные перед оформлением"
                  : mode === "loyalty"
                    ? "Заполните данные для программы лояльности"
                    : mode === "wheel"
                      ? "Заполните данные для рулетки"
                    : mode === "profile"
                      ? "Заполните данные для профиля"
                    : "Заполните данные перед добавлением"}
              </Text>
              <Text style={styles.description}>Введите номер телефона, чтобы продолжить.</Text>
              <TextInput
                accessibilityLabel="Номер телефона"
                autoComplete="tel"
                editable={!busy}
                keyboardType="phone-pad"
                onChangeText={(value) => setPhone(formatRussianPhoneInput(value))}
                placeholder="+7 (999) 123-45-67"
                style={styles.input}
                value={phone}
              />
              {validationError !== null || errorMessage !== null ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {validationError ?? errorMessage}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Отмена</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.primaryButton}>
                  {busy ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {mode === "checkout"
                        ? "Сохранить и продолжить"
                      : mode === "loyalty"
                          ? "Открыть лояльность"
                          : mode === "wheel"
                            ? "Открыть рулетку"
                          : mode === "profile"
                            ? "Открыть профиль"
                          : "Сохранить и добавить"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.62)", flex: 1, justifyContent: "center", padding: 18 },
  card: { backgroundColor: "#ffffff", borderRadius: 20, elevation: 12, maxWidth: 440, padding: 22, shadowColor: "#000000", shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.24, shadowRadius: 24, width: "100%" },
  title: { color: "#24170f", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  description: { color: "#6e665e", fontSize: 13, lineHeight: 19, marginBottom: 16 },
  input: { borderColor: "#ece8e2", borderRadius: 12, borderWidth: 1.5, color: "#24170f", fontSize: 16, marginBottom: 10, minHeight: 48, paddingHorizontal: 13, paddingVertical: 12 },
  hint: { color: "#8a8580", fontSize: 12, lineHeight: 17, marginBottom: 12 },
  error: { color: "#b42318", fontSize: 13, lineHeight: 18, marginBottom: 12 },
  actions: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 6 },
  cancelButton: { alignItems: "center", justifyContent: "center", minHeight: 48, paddingHorizontal: 12, paddingVertical: 12 },
  cancelButtonText: { color: "#6e665e", fontSize: 14, fontWeight: "700" },
  primaryButton: { alignItems: "center", backgroundColor: "#ff5e3a", borderRadius: 12, minHeight: 48, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 11 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" }
} as const;
