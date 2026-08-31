import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type {
  CatalogProduct,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogResponse
} from "@vse-pro-zhar/contracts";
import type { CatalogAdminClient } from "@vse-pro-zhar/api-client";

import { CatalogScreen } from "../src/components/catalog-screen";

const category = {
  id: 1,
  slug: "shashlyk",
  name: "Шашлык",
  sortOrder: 10,
  isVisible: true
};

function makeCatalog(product: CatalogProduct): CatalogResponse {
  return {
    categories: [{ ...category, products: [product] }]
  };
}

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 1,
    categoryId: 1,
    name: "Шашлык из свинины",
    description: "Сочный шашлык на углях, 200г",
    priceMinor: 45_000,
    imageUrl: null,
    emoji: "🥩",
    tag: "hit",
    isVisible: true,
    sortOrder: 0,
    ...overrides
  };
}

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : getNodeText(child)))
    .join("");
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Admin catalog screen", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("loads products and refreshes after hiding one", async () => {
    let catalog = makeCatalog(makeProduct());
    const client: CatalogAdminClient = {
      getAdminCatalog: async () => catalog,
      createCategory: async () => category,
      updateCategory: async () => category,
      uploadImage: async () => ({
        url: "https://cdn.example.test/uploaded.webp",
        format: "webp" as const,
        mimeType: "image/webp" as const,
        sizeBytes: 1_024,
        width: 1_200,
        height: 800
      }),
      createProduct: async (input: CatalogProductInput) => {
        const product = makeProduct(input);
        catalog = makeCatalog(product);
        return product;
      },
      updateProduct: async (id: number, input: CatalogProductUpdate) => {
        const current = catalog.categories[0]?.products[0];
        if (current === undefined || current.id !== id) {
          throw new Error("product not found");
        }
        const product = { ...current, ...input };
        catalog = makeCatalog(product);
        return product;
      }
    };
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(<CatalogScreen client={client} />);
      await flushPromises();
    });

    if (renderer === null) {
      throw new Error("Expected the Admin renderer to be created");
    }

    expect(getNodeText(renderer.root)).toContain("Шашлык из свинины");
    expect(getNodeText(renderer.root)).toContain("450₽");

    const hideButton = renderer.root.find(
      (node) =>
        node.props["aria-label"] === "Скрыть товар Шашлык из свинины"
    );
    await act(async () => {
      await hideButton.props.onClick();
      await flushPromises();
    });

    expect(getNodeText(renderer.root)).toContain("Скрыто");
    expect(getNodeText(renderer.root)).toContain("Показать");

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });

  it("converts an entered ruble price to integer minor units", async () => {
    let createdInput: CatalogProductInput | null = null;
    const client: CatalogAdminClient = {
      getAdminCatalog: async () => ({ categories: [{ ...category, products: [] }] }),
      createCategory: async () => category,
      updateCategory: async () => category,
      uploadImage: async () => ({
        url: "https://cdn.example.test/uploaded.webp",
        format: "webp" as const,
        mimeType: "image/webp" as const,
        sizeBytes: 1_024,
        width: 1_200,
        height: 800
      }),
      createProduct: async (input) => {
        createdInput = input;
        return makeProduct(input);
      },
      updateProduct: async () => makeProduct()
    };
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(<CatalogScreen client={client} />);
      await flushPromises();
    });

    if (renderer === null) {
      throw new Error("Expected the Admin renderer to be created");
    }

    const addButton = renderer.root.find(
      (node) =>
        getNodeText(node) === "＋ Добавить блюдо" &&
        typeof node.props.onClick === "function"
    );
    await act(async () => {
      addButton.props.onClick();
      await flushPromises();
    });

    const inputs = renderer.root.findAllByType("input");
    const nameInput = inputs.find((input) => input.props.placeholder === "Шашлык из…");
    const priceInput = inputs.find((input) => input.props.placeholder === "450");
    if (nameInput === undefined || priceInput === undefined) {
      throw new Error("Expected product form inputs");
    }

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Новый шашлык" } });
      priceInput.props.onChange({ target: { value: "450,50" } });
      await flushPromises();
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: () => undefined });
      await flushPromises();
    });

    expect(createdInput).toMatchObject({
      name: "Новый шашлык",
      priceMinor: 45_050
    });

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });

  it("uploads a computer photo before saving the product", async () => {
    let uploadedFile: Blob | null = null;
    let createdInput: CatalogProductInput | null = null;
    const client: CatalogAdminClient = {
      getAdminCatalog: async () => ({ categories: [{ ...category, products: [] }] }),
      createCategory: async () => category,
      updateCategory: async () => category,
      uploadImage: async (file) => {
        uploadedFile = file;
        return {
          url: "http://127.0.0.1:3000/media/optimized.webp",
          format: "webp" as const,
          mimeType: "image/webp" as const,
          sizeBytes: 18_000,
          width: 1_600,
          height: 1_200
        };
      },
      createProduct: async (input) => {
        createdInput = input;
        return makeProduct(input);
      },
      updateProduct: async () => makeProduct()
    };
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(<CatalogScreen client={client} />);
      await flushPromises();
    });

    if (renderer === null) {
      throw new Error("Expected the Admin renderer to be created");
    }

    const addButton = renderer.root.find(
      (node) =>
        getNodeText(node) === "＋ Добавить блюдо" &&
        typeof node.props.onClick === "function"
    );
    await act(async () => {
      addButton.props.onClick();
      await flushPromises();
    });

    const fileInput = renderer.root.find(
      (node) => node.props.type === "file"
    );
    await act(async () => {
      await fileInput.props.onChange({
        currentTarget: {
          files: [new Blob(["jpeg"], { type: "image/jpeg" })],
          value: ""
        }
      });
      await flushPromises();
    });

    expect(uploadedFile?.type).toBe("image/jpeg");
    expect(getNodeText(renderer.root)).toContain(
      "Фото сконвертировано в WebP и загружено."
    );

    const inputs = renderer.root.findAllByType("input");
    const nameInput = inputs.find((input) => input.props.placeholder === "Шашлык из…");
    const priceInput = inputs.find((input) => input.props.placeholder === "450");
    if (nameInput === undefined || priceInput === undefined) {
      throw new Error("Expected product form inputs");
    }

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Фото шашлыка" } });
      priceInput.props.onChange({ target: { value: "450" } });
      await flushPromises();
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: () => undefined });
      await flushPromises();
    });

    expect(createdInput).toMatchObject({
      imageUrl: "http://127.0.0.1:3000/media/optimized.webp",
      name: "Фото шашлыка"
    });

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });
});
