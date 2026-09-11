import { Redirect } from "expo-router";

/**
 * YooKassa returns the browser here after its hosted confirmation form.
 * Redirect is navigation only: payment truth is still read from the Backend
 * (the provider redirect itself never marks an order as paid).
 */
export default function PaymentReturn(): React.JSX.Element {
  return <Redirect href="/" />;
}
