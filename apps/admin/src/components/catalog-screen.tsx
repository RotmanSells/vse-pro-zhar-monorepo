import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CatalogClientError,
  createCatalogRequestController,
  type CatalogAdminClient,
  type CatalogRequestController,
  type CatalogRequestState
} from "@vse-pro-zhar/api-client";
import type {
  CatalogProduct,
  CatalogProductInput,
  CatalogProductUpdate
} from "@vse-pro-zhar/contracts";

interface ProductFormState {
  readonly name: string;
  readonly categoryId: string;
  readonly description: string;
  readonly price: string;
  readonly tag: "" | "hit" | "new";
  readonly emoji: string;
  readonly imageUrl: string;
  readonly isVisible: boolean;
}

interface ProductRow {
  readonly categoryName: string;
  readonly product: CatalogProduct;
}

type ImageUploadStatus = "idle" | "uploading" | "success" | "error";

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export interface CatalogScreenProps {
  readonly client: CatalogAdminClient;
}

const EMPTY_FORM: ProductFormState = {
  name: "",
  categoryId: "",
  description: "",
  price: "",
  tag: "",
  emoji: "🍽️",
  imageUrl: "",
  isVisible: true
};

function productToForm(product: CatalogProduct): ProductFormState {
  const rubles = Math.floor(product.priceMinor / 100);
  const kopecks = product.priceMinor % 100;

  return {
    name: product.name,
    categoryId: String(product.categoryId),
    description: product.description,
    price:
      kopecks === 0
        ? String(rubles)
        : `${rubles}.${String(kopecks).padStart(2, "0")}`,
    tag: product.tag ?? "",
    emoji: product.emoji,
    imageUrl: product.imageUrl ?? "",
    isVisible: product.isVisible
  };
}

function parsePriceMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) {
    return null;
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const whole = BigInt(wholePart ?? "0");
  const fraction = BigInt(fractionalPart.padEnd(2, "0") || "0");
  const minor = whole * 100n + fraction;

  if (minor > 100_000_000n) {
    return null;
  }

  return Number(minor);
}

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;

  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function getProductRows(catalog: CatalogRequestState): ProductRow[] {
  if (catalog.status !== "success") {
    return [];
  }

  return catalog.catalog.categories.flatMap((category) =>
    category.products.map((product) => ({
      categoryName: category.name,
      product
    }))
  );
}

function getMutationMessage(error: unknown): string {
  if (error instanceof CatalogClientError) {
    return error.message;
  }

  return "Не удалось сохранить изменения";
}

export function CatalogScreen({ client }: CatalogScreenProps): React.JSX.Element {
  const [catalogState, setCatalogState] = useState<CatalogRequestState>({
    status: "loading"
  });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(
    null
  );
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [imageUploadStatus, setImageUploadStatus] =
    useState<ImageUploadStatus>("idle");
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const controllerRef = useRef<CatalogRequestController | null>(null);
  const imagePreviewRef = useRef<string | null>(null);
  const imageUploadSequenceRef = useRef(0);

  const clearImagePreview = useCallback((): void => {
    const currentPreview = imagePreviewRef.current;

    if (currentPreview !== null) {
      URL.revokeObjectURL(currentPreview);
      imagePreviewRef.current = null;
    }

    setImagePreviewUrl(null);
  }, []);

  const resetImageUploadState = useCallback((): void => {
    imageUploadSequenceRef.current += 1;
    clearImagePreview();
    setImageUploadStatus("idle");
    setImageUploadError(null);
  }, [clearImagePreview]);

  const adminReadClient = useMemo(
    () => ({
      getCatalog: (options?: { readonly signal?: AbortSignal }) =>
        client.getAdminCatalog(options)
    }),
    [client]
  );

  useEffect(() => {
    const controller = createCatalogRequestController(
      adminReadClient,
      setCatalogState
    );
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.dispose();

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [adminReadClient]);

  const categories =
    catalogState.status === "success" ? catalogState.catalog.categories : [];
  const productRows = useMemo(
    () => getProductRows(catalogState),
    [catalogState]
  );
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");

    return productRows.filter(({ product }) => {
      const matchesCategory =
        categoryFilter === "all" || product.categoryId === Number(categoryFilter);
      const matchesSearch =
        normalizedSearch === "" ||
        product.name.toLocaleLowerCase("ru-RU").includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, productRows, search]);

  const imagePreviewSource =
    imagePreviewUrl ?? (form.imageUrl === "" ? null : form.imageUrl);

  const openCreateModal = useCallback((): void => {
    const firstCategory = categories[0];

    setEditingProduct(null);
    setMutationError(null);
    resetImageUploadState();
    setForm({
      ...EMPTY_FORM,
      categoryId: firstCategory === undefined ? "" : String(firstCategory.id)
    });
    setModalOpen(true);
  }, [categories, resetImageUploadState]);

  const openEditModal = useCallback((product: CatalogProduct): void => {
    setEditingProduct(product);
    setMutationError(null);
    resetImageUploadState();
    setForm(productToForm(product));
    setModalOpen(true);
  }, [resetImageUploadState]);

  const closeModal = useCallback((): void => {
    if (!isSaving) {
      setModalOpen(false);
      setMutationError(null);
      resetImageUploadState();
    }
  }, [isSaving, resetImageUploadState]);

  const refreshCatalog = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

  const updateForm = useCallback(
    <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const handleImageChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";

      if (file === undefined) {
        return;
      }

      const sequence = imageUploadSequenceRef.current + 1;
      imageUploadSequenceRef.current = sequence;
      clearImagePreview();
      setImageUploadError(null);

      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        setImageUploadStatus("error");
        setImageUploadError("Выберите JPG, PNG или WebP файл");
        return;
      }

      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setImageUploadStatus("error");
        setImageUploadError("Размер фотографии не должен превышать 10 MB");
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      imagePreviewRef.current = previewUrl;
      setImagePreviewUrl(previewUrl);
      setImageUploadStatus("uploading");

      try {
        const asset = await client.uploadImage(file);

        if (sequence !== imageUploadSequenceRef.current) {
          return;
        }

        updateForm("imageUrl", asset.url);
        setImageUploadStatus("success");
      } catch (error: unknown) {
        if (sequence !== imageUploadSequenceRef.current) {
          return;
        }

        setImageUploadStatus("error");
        setImageUploadError(getMutationMessage(error));
      }
    },
    [client, clearImagePreview, updateForm]
  );

  useEffect(() => {
    return () => {
      imageUploadSequenceRef.current += 1;
      const currentPreview = imagePreviewRef.current;

      if (currentPreview !== null) {
        URL.revokeObjectURL(currentPreview);
      }
    };
  }, []);

  const saveProduct = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setMutationError(null);

      const priceMinor = parsePriceMinor(form.price);
      const categoryId = Number(form.categoryId);

      if (priceMinor === null || !Number.isSafeInteger(categoryId) || categoryId < 1) {
        setMutationError("Укажите корректную цену и категорию");
        return;
      }

      const input: CatalogProductInput = {
        categoryId,
        name: form.name,
        description: form.description,
        priceMinor,
        imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
        emoji: form.emoji,
        tag: form.tag === "" ? null : form.tag,
        isVisible: form.isVisible,
        sortOrder: editingProduct?.sortOrder ?? 0
      };

      setIsSaving(true);

      try {
        if (editingProduct === null) {
          await client.createProduct(input);
        } else {
          const update: CatalogProductUpdate = input;
          await client.updateProduct(editingProduct.id, update);
        }

        setModalOpen(false);
        resetImageUploadState();
        refreshCatalog();
      } catch (error: unknown) {
        setMutationError(getMutationMessage(error));
      } finally {
        setIsSaving(false);
      }
    },
    [client, editingProduct, form, refreshCatalog, resetImageUploadState]
  );

  const toggleVisibility = useCallback(
    async (product: CatalogProduct): Promise<void> => {
      setMutationError(null);

      try {
        await client.updateProduct(product.id, { isVisible: !product.isVisible });
        refreshCatalog();
      } catch (error: unknown) {
        setMutationError(getMutationMessage(error));
      }
    },
    [client, refreshCatalog]
  );

  return (
    <section className="catalog-page" aria-labelledby="catalog-title">
      <div className="page-header">
        <div>
          <h1 className="page-title" id="catalog-title">
            Меню
          </h1>
          <p className="page-subtitle">Управление блюдами и категориями</p>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            disabled={categories.length === 0}
            onClick={openCreateModal}
            type="button"
          >
            <span aria-hidden="true">＋</span> Добавить блюдо
          </button>
        </div>
      </div>

      {catalogState.status === "loading" ? (
        <div className="catalog-state" role="status">
          Загружаем меню…
        </div>
      ) : null}

      {catalogState.status === "error" ? (
        <div className="catalog-state catalog-state-error" role="alert">
          <strong>Не удалось загрузить меню</strong>
          <span>{catalogState.message}</span>
          <button className="btn btn-outline" onClick={refreshCatalog} type="button">
            Повторить
          </button>
        </div>
      ) : null}

      {catalogState.status === "success" ? (
        <div className="table-card">
          <div className="table-header">
            <h2>Все блюда ({filteredRows.length})</h2>
            <div className="catalog-filters">
              <select
                aria-label="Фильтр по категории"
                className="table-search"
                onChange={(event) => setCategoryFilter(event.target.value)}
                value={categoryFilter}
              >
                <option value="all">Все категории</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Поиск блюда"
                className="table-search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти блюдо…"
                type="search"
                value={search}
              />
            </div>
          </div>

          {mutationError !== null ? (
            <div className="catalog-action-error" role="alert">
              {mutationError}
            </div>
          ) : null}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Фото</th>
                  <th scope="col">Название</th>
                  <th scope="col">Категория</th>
                  <th scope="col">Цена</th>
                  <th scope="col">Тег</th>
                  <th scope="col">Видимость</th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ categoryName, product }) => (
                  <tr key={product.id}>
                    <td data-label="Фото">
                      <div className="product-thumb">
                        <span aria-hidden="true">{product.emoji}</span>
                        {product.imageUrl !== null ? (
                          <img
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                            src={product.imageUrl}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Название">
                      <strong>{product.name}</strong>
                      <span className="product-description">
                        {product.description}
                      </span>
                    </td>
                    <td data-label="Категория">{categoryName}</td>
                    <td data-label="Цена">
                      <strong>{formatPriceMinor(product.priceMinor)}</strong>
                    </td>
                    <td data-label="Тег">
                      {product.tag === "hit" ? (
                        <span className="status-badge status-hot">🔥 Хит</span>
                      ) : null}
                      {product.tag === "new" ? (
                        <span className="status-badge status-new">🆕 Новинка</span>
                      ) : null}
                      {product.tag === null ? "—" : null}
                    </td>
                    <td data-label="Видимость">
                      <span
                        className={`status-badge ${
                          product.isVisible ? "status-visible" : "status-hidden"
                        }`}
                      >
                        {product.isVisible ? "Опубликовано" : "Скрыто"}
                      </span>
                    </td>
                    <td data-label="Действия">
                      <div className="row-actions">
                        <button
                          aria-label={`Редактировать ${product.name}`}
                          className="btn btn-sm btn-outline"
                          onClick={() => openEditModal(product)}
                          type="button"
                        >
                          ✎
                        </button>
                        <button
                          aria-label={`${product.isVisible ? "Скрыть" : "Показать"} товар ${product.name}`}
                          className="btn btn-sm btn-outline"
                          onClick={() => void toggleVisibility(product)}
                          type="button"
                        >
                          {product.isVisible ? "Скрыть" : "Показать"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={7}>
                      {productRows.length === 0
                        ? "Каталог пока пуст"
                        : "По вашему запросу блюда не найдены"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          aria-labelledby="product-modal-title"
          aria-modal="true"
          className="modal-overlay show"
          role="dialog"
        >
          <form className="modal-box" onSubmit={(event) => void saveProduct(event)}>
            <h2 id="product-modal-title">
              {editingProduct === null ? "Новое блюдо" : "Редактировать блюдо"}
            </h2>

            <div className="form-row">
              <label className="form-group">
                <span>Название</span>
                <input
                  autoFocus
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="Шашлык из…"
                  required
                  value={form.name}
                />
              </label>
              <label className="form-group">
                <span>Категория</span>
                <select
                  onChange={(event) => updateForm("categoryId", event.target.value)}
                  required
                  value={form.categoryId}
                >
                  <option disabled value="">
                    Выберите категорию
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="form-group">
              <span>Описание</span>
              <input
                maxLength={500}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="Сочный шашлык на углях…"
                value={form.description}
              />
            </label>

            <div className="form-row">
              <label className="form-group">
                <span>Цена (₽)</span>
                <input
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => updateForm("price", event.target.value)}
                  placeholder="450"
                  required
                  type="text"
                  value={form.price}
                />
              </label>
              <label className="form-group">
                <span>Тег</span>
                <select
                  onChange={(event) =>
                    updateForm("tag", event.target.value as ProductFormState["tag"])
                  }
                  value={form.tag}
                >
                  <option value="">Без тега</option>
                  <option value="hit">🔥 Хит</option>
                  <option value="new">🆕 Новинка</option>
                </select>
              </label>
            </div>

            <div className="form-row">
              <label className="form-group">
                <span>Эмодзи</span>
                <input
                  maxLength={32}
                  onChange={(event) => updateForm("emoji", event.target.value)}
                  placeholder="🥩"
                  required
                  value={form.emoji}
                />
              </label>
              <label className="form-group">
                <span>URL фото</span>
                <input
                  maxLength={1_000}
                  onChange={(event) => updateForm("imageUrl", event.target.value)}
                  placeholder="https://…"
                  type="url"
                  value={form.imageUrl}
                />
              </label>
            </div>

            <div className="image-upload-panel">
              <label className="form-group image-upload-field">
                <span>Фото с компьютера</span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Фото с компьютера"
                  disabled={imageUploadStatus === "uploading"}
                  onChange={(event) => void handleImageChange(event)}
                  type="file"
                />
              </label>
              <p className="image-upload-note">
                JPG, PNG или WebP до 10 MB. Сервер автоматически повернёт,
                сожмёт и сохранит фото в WebP.
              </p>
              {imagePreviewSource !== null ? (
                <div className="image-upload-preview">
                  <img alt="Предпросмотр фото" src={imagePreviewSource} />
                  <span>
                    {imageUploadStatus === "uploading"
                      ? "Конвертируем и загружаем…"
                      : "Фото готово к сохранению товара"}
                  </span>
                </div>
              ) : null}
              {imageUploadStatus === "uploading" ? (
                <p className="image-upload-status" role="status">
                  Обрабатываем изображение…
                </p>
              ) : null}
              {imageUploadStatus === "success" ? (
                <p className="image-upload-status image-upload-success">
                  Фото сконвертировано в WebP и загружено.
                </p>
              ) : null}
              {imageUploadError !== null ? (
                <p className="image-upload-status image-upload-error" role="alert">
                  {imageUploadError}
                </p>
              ) : null}
            </div>

            {mutationError !== null ? (
              <div className="catalog-action-error" role="alert">
                {mutationError}
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={closeModal} type="button">
                Отмена
              </button>
              <button
                className="btn btn-primary"
                disabled={isSaving || imageUploadStatus === "uploading"}
                type="submit"
              >
                {isSaving
                  ? "Сохраняем…"
                  : imageUploadStatus === "uploading"
                    ? "Загрузка…"
                    : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
