import { Linking } from "react-native";

export interface PaymentConfirmationNavigator {
  open(url: string): Promise<void>;
}

export function createPlatformPaymentConfirmationNavigator(): PaymentConfirmationNavigator {
  return {
    open: async (url) => {
      await Linking.openURL(url);
    }
  };
}
