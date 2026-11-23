"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Award,
  Check,
  MinusCircle,
  Pencil,
  Plus,
  PlusCircle,
  RotateCcw,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { computeMeritBalanceUpdate } from "@/lib/points/merit-math";
import { cn } from "@/lib/utils";
import { PointLedgerFeed, type LedgerStudentOption } from "./point-ledger-feed";

export interface MeritPresetDto {
  id: string;
  subjectId: string;
  name: string;
  type: "MERIT" | "DEMERIT";
  pointsDelta: number;
  description: string | null;
  isArchived: boolean;
}

export interface MeritRosterStudent {
  id: string; // enrollmentId
  availableBalance: number;
  escrowedBalance: number;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
}

interface TeacherMeritsPanelProps {
  subjectId: string;
  isArchived: boolean;
  pointsEnabled?: boolean;
  allowNegativeBalance: boolean;
  roster: MeritRosterStudent[];
  isOwner?: boolean;
}

export function TeacherMeritsPanel({
  subjectId,
  isArchived,
  pointsEnabled = true,
  allowNegativeBalance,
  roster,
  isOwner = true,
}: TeacherMeritsPanelProps) {
  const queryClient = useQueryClient();

  // Policy toggle state
  const [policySaving, setPolicySaving] = useState(false);

  // Preset creation / editing state
  const [showArchivedPresets, setShowArchivedPresets] = useState(false);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetType, setPresetType] = useState<"MERIT" | "DEMERIT">("MERIT");
  const [presetPoints, setPresetPoints] = useState(5);
  const [presetDescription, setPresetDescription] = useState("");
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  // Award / Deduct form state
  const [awardMode, setAwardMode] = useState<"PRESET" | "CUSTOM">("PRESET");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [customType, setCustomType] = useState<"MERIT" | "DEMERIT">("MERIT");
  const [customPoints, setCustomPoints] = useState(5);
  const [awardNote, setAwardNote] = useState("");
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [awardSubmitting, setAwardSubmitting] = useState(false);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [awardSuccess, setAwardSuccess] = useState<string | null>(null);

  const { data: presetsData } = useQuery<{ presets: MeritPresetDto[] }>({
    queryKey: ["subject-presets", subjectId, showArchivedPresets],
    queryFn: async () => {
      const res = await fetch(
        `/api/subjects/${subjectId}/presets?includeArchived=${showArchivedPresets ? "true" : "false"}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) {
        throw new Error("Unable to load merit presets.");
      }
      return (await res.json()) as { presets: MeritPresetDto[] };
    },
  });

  const presets = presetsData?.presets ?? [];
  const activePresets = presets.filter((p) => !p.isArchived);

  const activePreset = useMemo(
    () => activePresets.find((p) => p.id === selectedPresetId) ?? null,
    [activePresets, selectedPresetId]
  );

  const previewDelta = useMemo(() => {
    if (awardMode === "PRESET") {
      return activePreset?.pointsDelta ?? 0;
    }
    if (!Number.isInteger(customPoints) || customPoints <= 0) {
      return 0;
    }
    return customType === "MERIT" ? customPoints : -customPoints;
  }, [awardMode, activePreset, customType, customPoints]);

  const filteredRoster = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    if (!query) return roster;
    return roster.filter(
      (r) =>
        r.student.fullName.toLowerCase().includes(query) ||
        r.student.email.toLowerCase().includes(query) ||
        (r.student.institutionalId?.toLowerCase().includes(query) ?? false)
    );
  }, [roster, studentSearch]);

  const ledgerStudents: LedgerStudentOption[] = useMemo(
    () =>
      roster.map((r) => ({
        enrollmentId: r.id,
        fullName: r.student.fullName,
        institutionalId: r.student.institutionalId,
      })),
    [roster]
  );

  async function handleToggleNegativeBalance() {
    setPolicySaving(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowNegativeBalance: !allowNegativeBalance }),
      });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
      }
    } finally {
      setPolicySaving(false);
    }
  }

  function resetPresetForm() {
    setEditingPresetId(null);
    setPresetName("");
    setPresetType("MERIT");
    setPresetPoints(5);
    setPresetDescription("");
    setPresetError(null);
    setShowPresetForm(false);
  }

  function startEditPreset(preset: MeritPresetDto) {
    setEditingPresetId(preset.id);
    setPresetName(preset.name);
    setPresetType(preset.type);
    setPresetPoints(Math.abs(preset.pointsDelta));
    setPresetDescription(preset.description ?? "");
    setPresetError(null);
    setShowPresetForm(true);
  }

  async function handleSavePreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPresetError(null);
    setPresetSaving(true);

    const signedDelta =
      presetType === "MERIT" ? Math.abs(presetPoints) : -Math.abs(presetPoints);

    try {
      const url = editingPresetId
        ? `/api/subjects/${subjectId}/presets/${editingPresetId}`
        : `/api/subjects/${subjectId}/presets`;
      const method = editingPresetId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName,
          type: presetType,
          pointsDelta: signedDelta,
          description: presetDescription || null,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        preset?: MeritPresetDto;
      };
      if (!res.ok) {
        setPresetError(payload.error ?? "Unable to save preset.");
        return;
      }

      if (!editingPresetId && payload.preset) {
        setSelectedPresetId(payload.preset.id);
        setAwardMode("PRESET");
      }
      await queryClient.invalidateQueries({
        queryKey: ["subject-presets", subjectId],
      });
      resetPresetForm();
    } catch {
      setPresetError("Network error while saving preset.");
    } finally {
      setPresetSaving(false);
    }
  }

  async function handleArchivePreset(preset: MeritPresetDto) {
    await fetch(`/api/subjects/${subjectId}/presets/${preset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: !preset.isArchived }),
    });
    if (selectedPresetId === preset.id && !preset.isArchived) {
      setSelectedPresetId("");
    }
    await queryClient.invalidateQueries({
      queryKey: ["subject-presets", subjectId],
    });
  }

  function toggleStudent(enrollmentId: string) {
    setSelectedEnrollmentIds((prev) =>
      prev.includes(enrollmentId)
        ? prev.filter((id) => id !== enrollmentId)
        : [...prev, enrollmentId]
    );
  }

  function selectAllFiltered() {
    const filteredIds = filteredRoster.map((r) => r.id);
    setSelectedEnrollmentIds((prev) =>
      Array.from(new Set([...prev, ...filteredIds]))
    );
  }

  async function handleAwardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAwardError(null);
    setAwardSuccess(null);

    if (selectedEnrollmentIds.length === 0) {
      setAwardError("Select at least one student from the roster.");
      return;
    }

    if (awardMode === "PRESET" && !selectedPresetId) {
      setAwardError("Select a merit or demerit preset.");
      return;
    }

    const signedCustomDelta =
      customType === "MERIT" ? Math.abs(customPoints) : -Math.abs(customPoints);

    setAwardSubmitting(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: selectedEnrollmentIds,
          ...(awardMode === "PRESET"
            ? { presetId: selectedPresetId }
            : { pointsDelta: signedCustomDelta }),
          ...(awardNote.trim() ? { note: awardNote.trim() } : {}),
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        entryType?: "MERIT" | "DEMERIT";
        requestedDelta?: number;
        results?: { clamped: boolean }[];
      };

      if (!res.ok) {
        setAwardError(payload.error ?? "Failed to apply point adjustment.");
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subject-roster", subjectId] }),
        queryClient.invalidateQueries({ queryKey: ["subject-ledger", subjectId] }),
        queryClient.invalidateQueries({ queryKey: ["subject-wallet", subjectId] }),
      ]);

      const count = payload.results?.length ?? selectedEnrollmentIds.length;
      const clampedCount =
        payload.results?.filter((r) => r.clamped).length ?? 0;
      const deltaLabel =
        (payload.requestedDelta ?? 0) > 0
          ? `+${payload.requestedDelta}`
          : `${payload.requestedDelta}`;

      setAwardSuccess(
        `Applied ${deltaLabel} pts to ${count} student${count === 1 ? "" : "s"}${
          clampedCount > 0
            ? ` (${clampedCount} floored at 0 pts)`
            : ""
        }.`
      );
      setAwardNote("");
      setSelectedEnrollmentIds([]);
    } catch {
      setAwardError("Network error while recording points.");
    } finally {
      setAwardSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-6">
      {/* Header + Negative Balance Policy Toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Merits, Demerits &amp; Point Economy
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            Award or deduct points individually or in bulk. Every adjustment writes an immutable ledger record.
          </p>
        </div>

        {isOwner && pointsEnabled && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Settings2 className="h-3.5 w-3.5 text-slate-500" />
                <span>Allow Negative Point Balance</span>
              </span>
              <p className="text-[11px] text-slate-500">
                {allowNegativeBalance
                  ? "Debt enabled: demerits can push balances below 0."
                  : "Floored at 0: demerits stop at 0 pts while logging full infraction."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Allow Negative Point Balance"
              aria-checked={allowNegativeBalance}
              disabled={policySaving}
              onClick={handleToggleNegativeBalance}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                allowNegativeBalance ? "bg-indigo-600" : "bg-slate-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                  allowNegativeBalance ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
        )}
      </div>

      {!pointsEnabled && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-700">
          Points &amp; Economy is disabled for this section. Merit/demerit presets and point adjustments are locked while existing balances and ledger history remain preserved.
        </div>
      )}

      {isArchived && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          This subject is archived. Unarchive it to award merits or demerits.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: Presets Management */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Merit &amp; Demerit Presets
              </h4>
              {isOwner && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowArchivedPresets((v) => !v)}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                  >
                    {showArchivedPresets ? "Hide archived" : "Show archived"}
                  </button>
                  <button
                    type="button"
                    disabled={!pointsEnabled || isArchived}
                    onClick={() => {
                      if (showPresetForm && !editingPresetId) {
                        resetPresetForm();
                      } else {
                        setEditingPresetId(null);
                        setPresetName("");
                        setPresetDescription("");
                        setPresetPoints(5);
                        setPresetType("MERIT");
                        setShowPresetForm(true);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>New Preset</span>
                  </button>
                </div>
              )}
            </div>

            {showPresetForm && (
              <form
                onSubmit={handleSavePreset}
                className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2.5"
              >
                <p className="text-xs font-semibold text-slate-800">
                  {editingPresetId ? "Edit Preset" : "Create Preset"}
                </p>
                <div className="space-y-1">
                  <label
                    htmlFor="preset-name"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    Preset Label
                  </label>
                  <input
                    id="preset-name"
                    type="text"
                    required
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="e.g. Active Recitation"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label
                      htmlFor="preset-type"
                      className="block text-[11px] font-semibold text-slate-700"
                    >
                      Type
                    </label>
                    <select
                      id="preset-type"
                      value={presetType}
                      onChange={(e) =>
                        setPresetType(e.target.value as "MERIT" | "DEMERIT")
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="MERIT">Merit (+)</option>
                      <option value="DEMERIT">Demerit (-)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="preset-points"
                      className="block text-[11px] font-semibold text-slate-700"
                    >
                      Points
                    </label>
                    <input
                      id="preset-points"
                      type="number"
                      min={1}
                      max={1000}
                      required
                      value={presetPoints}
                      onChange={(e) => setPresetPoints(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="preset-description"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    Description (optional)
                  </label>
                  <input
                    id="preset-description"
                    type="text"
                    value={presetDescription}
                    onChange={(e) => setPresetDescription(e.target.value)}
                    placeholder="When to apply this preset"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {presetError && (
                  <p className="text-[11px] text-rose-600">{presetError}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={resetPresetForm}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={presetSaving}
                    className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {presetSaving
                      ? "Saving..."
                      : editingPresetId
                      ? "Save Preset"
                      : "Create Preset"}
                  </button>
                </div>
              </form>
            )}

            {presets.length === 0 ? (
              <p className="text-xs text-slate-500">
                No presets yet. Create reusable Merit/Demerit presets or use custom adjustments.
              </p>
            ) : (
              <div className="space-y-2">
                {presets.map((preset) => {
                  const isMerit = preset.type === "MERIT";
                  const isSelected =
                    awardMode === "PRESET" && selectedPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className={cn(
                        "rounded-xl border p-2.5 bg-white flex items-center justify-between gap-2 transition-colors",
                        isSelected
                          ? "border-indigo-500 ring-1 ring-indigo-500"
                          : "border-slate-200",
                        preset.isArchived && "opacity-60"
                      )}
                    >
                      <button
                        type="button"
                        disabled={preset.isArchived}
                        onClick={() => {
                          setAwardMode("PRESET");
                          setSelectedPresetId(preset.id);
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold",
                              isMerit
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            )}
                          >
                            {isMerit
                              ? `+${preset.pointsDelta}`
                              : preset.pointsDelta}
                          </span>
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {preset.name}
                          </span>
                        </div>
                        {preset.description && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {preset.description}
                          </p>
                        )}
                      </button>

                      {isOwner && pointsEnabled && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditPreset(preset)}
                            aria-label={`Edit ${preset.name}`}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchivePreset(preset)}
                            aria-label={
                              preset.isArchived
                                ? `Restore ${preset.name}`
                                : `Archive ${preset.name}`
                            }
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            {preset.isArchived ? (
                              <RotateCcw className="h-3.5 w-3.5" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Quick / Bulk Award Form */}
        <form
          onSubmit={handleAwardSubmit}
          className="lg:col-span-3 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-indigo-600" />
              <span>Quick Award / Bulk Conduct Adjustment</span>
            </h4>

            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setAwardMode("PRESET")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                  awardMode === "PRESET"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Use Preset
              </button>
              <button
                type="button"
                onClick={() => setAwardMode("CUSTOM")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                  awardMode === "CUSTOM"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Custom +/-
              </button>
            </div>
          </div>

          {awardMode === "PRESET" ? (
            <div className="space-y-2">
              <label
                htmlFor="award-preset-select"
                className="block text-xs font-semibold text-slate-700"
              >
                Selected Preset
              </label>
              <select
                id="award-preset-select"
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-- Choose a merit or demerit preset --</option>
                {activePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.type === "MERIT" ? `+${p.pointsDelta}` : p.pointsDelta} pts
                    — {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="block text-xs font-semibold text-slate-700">
                  Adjustment Type
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCustomType("MERIT")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 rounded-xl border py-2 text-xs font-semibold",
                      customType === "MERIT"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-slate-700 border-slate-300"
                    )}
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Merit (+)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomType("DEMERIT")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 rounded-xl border py-2 text-xs font-semibold",
                      customType === "DEMERIT"
                        ? "bg-rose-600 text-white border-rose-600"
                        : "bg-white text-slate-700 border-slate-300"
                    )}
                  >
                    <MinusCircle className="h-3.5 w-3.5" />
                    <span>Demerit (-)</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="custom-points-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Points Amount
                </label>
                <input
                  id="custom-points-input"
                  type="number"
                  min={1}
                  max={1000}
                  value={customPoints}
                  onChange={(e) => setCustomPoints(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label
              htmlFor="merit-note-input"
              className="block text-xs font-semibold text-slate-700"
            >
              Reason / Note{" "}
              {awardMode === "CUSTOM" ? "(required)" : "(optional)"}
            </label>
            <input
              id="merit-note-input"
              type="text"
              value={awardNote}
              onChange={(e) => setAwardNote(e.target.value)}
              placeholder={
                awardMode === "CUSTOM"
                  ? "e.g. Solved bonus board problem"
                  : "Add context for the student ledger (optional)"
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Student Multi-Select Roster */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-slate-500" />
                <span>
                  Select Students ({selectedEnrollmentIds.length}/
                  {roster.length})
                </span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEnrollmentIds([])}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                >
                  Clear
                </button>
              </div>
            </div>

            {roster.length > 5 && (
              <input
                type="search"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Filter students by name or ID..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
              />
            )}

            {roster.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                Enroll students in the roster below before awarding points.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {filteredRoster.map((entry) => {
                  const checked = selectedEnrollmentIds.includes(entry.id);
                  const preview =
                    previewDelta !== 0
                      ? computeMeritBalanceUpdate({
                          currentBalance: entry.availableBalance,
                          requestedDelta: previewDelta,
                          allowNegativeBalance,
                        })
                      : null;

                  return (
                    <label
                      key={entry.id}
                      className={cn(
                        "flex items-center justify-between gap-3 px-3 py-2 cursor-pointer transition-colors",
                        checked ? "bg-indigo-50/60" : "hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStudent(entry.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {entry.student.fullName}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {entry.student.institutionalId ??
                              entry.student.email}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0 text-[11px] font-semibold">
                        <span className="text-slate-700">
                          {entry.availableBalance} pts
                        </span>
                        {checked && preview && (
                          <span
                            className={cn(
                              "ml-1.5",
                              preview.actualDelta > 0
                                ? "text-emerald-600"
                                : "text-rose-600"
                            )}
                          >
                            -&gt; {preview.newBalance} pts
                            {preview.clamped ? " (floored)" : ""}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {awardError && (
            <p className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              {awardError}
            </p>
          )}
          {awardSuccess && (
            <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-800 flex items-center gap-1.5">
              <Check className="h-4 w-4 shrink-0" />
              <span>{awardSuccess}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={
              !pointsEnabled || isArchived || awardSubmitting || roster.length === 0
            }
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <span>
              {awardSubmitting
                ? "Recording Points..."
                : `Apply to ${selectedEnrollmentIds.length} Student${
                    selectedEnrollmentIds.length === 1 ? "" : "s"
                  }`}
            </span>
          </button>
        </form>
      </div>

      {/* Subject & Per-Student Conduct Ledger */}
      <div className="border-t border-slate-100 pt-5">
        <PointLedgerFeed
          subjectId={subjectId}
          mode="teacher"
          students={ledgerStudents}
        />
      </div>
    </section>
  );
}
