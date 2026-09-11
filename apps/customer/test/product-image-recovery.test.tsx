import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Image } from "react-native";

import type { CatalogProduct } from "@vse-pro-zhar/contracts";

import { ProductImage } from "../src/components/cart-screen";
import { ProductCard } from "../src/components/catalog-screen";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  Text: "Text",
  View: "View"
}));

const product: CatalogProduct = {
  id: 1,
  categoryId: 1,
  name: "Шашлык",
  description: "Описание",
  priceMinor: 45_050,
  imageUrl: "https://images.example.test/old.webp",
  emoji: "🥩",
  tag: null,
  isVisible: true,
  sortOrder: 0
};

async function assertImageRecovers(
  render: (value: CatalogProduct) => React.JSX.Element
): Promise<void> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(render(product));
  });
  const firstImage = renderer?.root.findByType(Image);
  await act(async () => {
    firstImage?.props["onError"]();
  });
  expect(renderer?.root.findAllByType(Image)).toHaveLength(0);

  const updated = { ...product, imageUrl: "https://images.example.test/new.webp" };
  await act(async () => {
    renderer?.update(render(updated));
  });

  expect(renderer?.root.findByType(Image).props["source"]).toEqual({ uri: updated.imageUrl });
  await act(async () => renderer?.unmount());
}

describe("product image recovery", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("retries a replaced catalog image after the old URL failed", async () => {
    await assertImageRecovers((value) => (
      <ProductCard disabled={false} onAdd={() => undefined} product={value} />
    ));
  });

  it("retries a replaced cart image after the old URL failed", async () => {
    await assertImageRecovers((value) => <ProductImage product={value} />);
  });
});
