"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Store } from "@/lib/accounting/types";

const MARKETPLACE_OPTIONS = [
  "Amazon US",
  "Amazon CA",
  "Amazon UK",
  "Amazon DE",
  "Amazon FR",
  "Amazon IT",
  "Amazon ES",
  "Amazon JP",
  "Amazon AU",
];

export function StoreManagementView() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");

  // Modal states for Store
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [storeFormData, setStoreFormData] = useState({
    name: "",
    marketplace: "Amazon US",
    team: "NCE",
    seller_id: "",
    legal_entity: "",
    status: "active" as "active" | "inactive",
  });
  const [savingStore, setSavingStore] = useState(false);
  const [storeFormError, setStoreFormError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/accounting/stores");
      if (!res.ok) throw new Error("Failed to load stores");
      const data = (await res.json()) as { stores?: Store[]; error?: string };
      setStores(data.stores || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  // Unique teams for filter dropdown
  const uniqueTeams = useMemo(() => {
    const set = new Set<string>();
    stores.forEach((s) => {
      if (s.team) set.add(s.team);
    });
    return Array.from(set).sort();
  }, [stores]);

  const filteredStores = useMemo(() => {
    return stores.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (teamFilter !== "all" && s.team !== teamFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchName = s.name.toLowerCase().includes(query);
        const matchMarketplace = s.marketplace.toLowerCase().includes(query);
        const matchTeam = (s.team || "").toLowerCase().includes(query);
        const matchSeller = (s.seller_id || "").toLowerCase().includes(query);
        const matchLegal = (s.legal_entity || s.legal_entity_name || "").toLowerCase().includes(query);
        return matchName || matchMarketplace || matchTeam || matchSeller || matchLegal;
      }
      return true;
    });
  }, [stores, statusFilter, teamFilter, searchQuery]);

  const handleOpenAddStore = () => {
    setEditingStore(null);
    setStoreFormData({
      name: "",
      marketplace: "Amazon US",
      team: "NCE",
      seller_id: "",
      legal_entity: "",
      status: "active",
    });
    setStoreFormError(null);
    setIsStoreModalOpen(true);
  };

  const handleOpenEditStore = (store: Store) => {
    setEditingStore(store);
    setStoreFormData({
      name: store.name,
      marketplace: store.marketplace,
      team: store.team || "NCE",
      seller_id: store.seller_id || "",
      legal_entity: store.legal_entity || store.legal_entity_name || "",
      status: store.status,
    });
    setStoreFormError(null);
    setIsStoreModalOpen(true);
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeFormData.name.trim()) {
      setStoreFormError("Store name is required.");
      return;
    }
    if (!storeFormData.marketplace.trim()) {
      setStoreFormError("Marketplace is required.");
      return;
    }

    setSavingStore(true);
    setStoreFormError(null);
    try {
      const payload = {
        name: storeFormData.name.trim(),
        marketplace: storeFormData.marketplace.trim(),
        team: storeFormData.team.trim() || "NCE",
        seller_id: storeFormData.seller_id.trim() || null,
        legal_entity: storeFormData.legal_entity.trim() || null,
        status: storeFormData.status,
      };

      const url = editingStore
        ? `/api/accounting/stores/${editingStore.id}`
        : "/api/accounting/stores";
      const method = editingStore ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = (await res.json()) as { store?: Store; error?: string };
      if (!res.ok) {
        throw new Error(resData.error || "Failed to save store.");
      }

      setIsStoreModalOpen(false);
      await fetchStores();
    } catch (err) {
      setStoreFormError(err instanceof Error ? err.message : "Error saving store.");
    } finally {
      setSavingStore(false);
    }
  };

  const handleDeleteStore = async () => {
    if (!editingStore) return;
    if (!window.confirm(`Are you sure you want to delete store "${editingStore.name}"?`)) {
      return;
    }
    setSavingStore(true);
    try {
      const res = await fetch(`/api/accounting/stores/${editingStore.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete store.");
      setIsStoreModalOpen(false);
      await fetchStores();
    } catch (err) {
      setStoreFormError(err instanceof Error ? err.message : "Error deleting store.");
    } finally {
      setSavingStore(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Top Main Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900">
            Store Management
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            Manage all Amazon seller accounts, marketplace, team assignments, and operational status
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddStore}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs sm:text-sm font-bold hover:bg-indigo-700 active:bg-indigo-800 transition shadow-sm cursor-pointer shrink-0"
        >
          <span>+ Add Store</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search store name, marketplace, team..."
            className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Team Filter */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-slate-600">Team:</span>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-2xs cursor-pointer min-w-32"
          >
            <option value="all">All Teams</option>
            {uniqueTeams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-slate-600">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-2xs cursor-pointer min-w-32"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Stores Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm font-medium text-slate-400">
            Loading stores...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-600 bg-rose-50/50">
            {error}
          </div>
        ) : filteredStores.length === 0 ? (
          <div className="py-16 text-center text-sm font-medium text-slate-500">
            No stores found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <th className="py-3.5 px-5">Store</th>
                  <th className="py-3.5 px-5">Marketplace</th>
                  <th className="py-3.5 px-5">Team</th>
                  <th className="py-3.5 px-5">Status</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStores.map((store) => (
                  <tr
                    key={store.id}
                    onClick={() => handleOpenEditStore(store)}
                    className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-4 px-5 font-black text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {store.name}
                    </td>
                    <td className="py-4 px-5 text-slate-700 font-semibold">
                      {store.marketplace}
                    </td>
                    <td className="py-4 px-5 text-slate-700 font-semibold">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
                        {store.team || "NCE"}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      {store.status === "active" ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                          <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                          <span>Inactive</span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditStore(store);
                        }}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60 hover:bg-indigo-600 hover:text-white transition-all shadow-2xs cursor-pointer"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Screen 2: Add / Edit Store Modal */}
      {isStoreModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4.5 bg-slate-50/80">
              <h2 className="text-base sm:text-lg font-black text-slate-900">
                {editingStore ? "Edit Store" : "Store Information"}
              </h2>
              <button
                type="button"
                onClick={() => !savingStore && setIsStoreModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-base font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveStore} className="p-6 space-y-4.5">
              {storeFormError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-xs sm:text-sm">
                  {storeFormError}
                </div>
              )}

              {/* 1. Store Name */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Store Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={storeFormData.name}
                  onChange={(e) => setStoreFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. warmstorey"
                  className="w-full h-11 bg-white border border-slate-300 rounded-xl px-4 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 shadow-2xs"
                />
              </div>

              {/* 2. Marketplace */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Marketplace <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={storeFormData.marketplace}
                  onChange={(e) => setStoreFormData((prev) => ({ ...prev, marketplace: e.target.value }))}
                  className="w-full h-11 bg-white border border-slate-300 rounded-xl px-4 text-sm font-semibold text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 shadow-2xs cursor-pointer"
                >
                  {MARKETPLACE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Team */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Team <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={storeFormData.team}
                  onChange={(e) => setStoreFormData((prev) => ({ ...prev, team: e.target.value }))}
                  placeholder="e.g. NCE, Team 1, Team 2..."
                  className="w-full h-11 bg-white border border-slate-300 rounded-xl px-4 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 shadow-2xs"
                />
              </div>

              {/* 4. Seller ID */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Seller ID
                </label>
                <input
                  type="text"
                  value={storeFormData.seller_id}
                  onChange={(e) => setStoreFormData((prev) => ({ ...prev, seller_id: e.target.value }))}
                  placeholder="e.g. AXXXXXXXXXXXX"
                  className="w-full h-11 bg-white border border-slate-300 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 shadow-2xs"
                />
              </div>

              {/* 5. Legal Entity (Đặt ở cuối - bổ sung sau khi đăng ký hộ kinh doanh) */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Legal Entity (Pháp nhân / Hộ kinh doanh)
                </label>
                <input
                  type="text"
                  value={storeFormData.legal_entity}
                  onChange={(e) => setStoreFormData((prev) => ({ ...prev, legal_entity: e.target.value }))}
                  placeholder="Bổ sung sau khi đăng ký hộ kinh doanh (VD: NCE US LLC, Hộ KD...)"
                  className="w-full h-11 bg-white border border-slate-300 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 shadow-2xs"
                />
              </div>

              {/* 6. Status (Segmented Pill Buttons) */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">
                  Status
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStoreFormData((prev) => ({ ...prev, status: "active" }))}
                    className={`h-11 flex items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all cursor-pointer ${
                      storeFormData.status === "active"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-200"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Active
                  </button>

                  <button
                    type="button"
                    onClick={() => setStoreFormData((prev) => ({ ...prev, status: "inactive" }))}
                    className={`h-11 flex items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all cursor-pointer ${
                      storeFormData.status === "inactive"
                        ? "bg-slate-100 border-slate-400 text-slate-800 ring-2 ring-slate-200"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    Inactive
                  </button>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                {editingStore ? (
                  <button
                    type="button"
                    onClick={handleDeleteStore}
                    disabled={savingStore}
                    className="text-sm font-bold text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Delete Store
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => !savingStore && setIsStoreModalOpen(false)}
                    disabled={savingStore}
                    className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingStore}
                    className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:bg-indigo-800 transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {savingStore ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
