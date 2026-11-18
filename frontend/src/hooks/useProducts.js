import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage } from "../utils/api.js";

const publicApi = { skipAuth: true };
const PAGE = 12;

/**
 * Pages through GET /marketplace/products (dishes, Mart items, or one shop's menu).
 * Changing a filter starts over; `loadMore` appends the next page without repeats.
 */
export function useProducts({ group = "FOOD", category = "", vendorId = null, q = "", limit = PAGE } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ categories: [], shop: null, isChayakadi: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const cursor = useRef(null);
  const generation = useRef(0);
  const busy = useRef(false);

  const fetchPage = useCallback(
    async (first) => {
      const mine = generation.current;
      busy.current = true;
      first ? setLoading(true) : setLoadingMore(true);
      try {
        const params = { limit, group };
        if (category) params.category = category;
        if (vendorId) params.vendor_id = vendorId;
        if (q) params.q = q;
        if (!first && cursor.current) params.cursor = cursor.current;
        const { data } = await api.get("/marketplace/products", { ...publicApi, params });
        if (mine !== generation.current) return;
        const page = data.data;
        setItems((current) => {
          if (first) return page.items;
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setMeta((current) => ({
          categories: page.categories?.length ? page.categories : current.categories,
          shop: page.shop ?? null,
          isChayakadi: page.is_chayakadi_window,
        }));
        cursor.current = data.meta?.pagination?.next_cursor ?? null;
        setHasMore(Boolean(data.meta?.pagination?.has_more && cursor.current));
        setError("");
      } catch (err) {
        if (mine === generation.current) {
          setError(getErrorMessage(err, "Could not load the list."));
          setHasMore(false);
        }
      } finally {
        if (mine === generation.current) {
          busy.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [group, category, vendorId, q, limit]
  );

  // A new filter (or a reload) starts again from the first page.
  useEffect(() => {
    generation.current += 1;
    cursor.current = null;
    setItems([]);
    setHasMore(false);
    fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!busy.current && cursor.current) fetchPage(false);
  }, [fetchPage]);
  const reload = useCallback(() => {
    generation.current += 1;
    cursor.current = null;
    fetchPage(true);
  }, [fetchPage]);

  return { items, ...meta, loading, loadingMore, hasMore, error, loadMore, reload };
}
