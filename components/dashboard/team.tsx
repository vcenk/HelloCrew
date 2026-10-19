"use client";

import { useRef, useState } from "react";
import { Check, Plus, Trash2, UserRound, Users, X } from "lucide-react";

import {
  MAX_TEAM,
  type KnowledgeStore,
  type PriceOption,
  type TeamMember,
} from "@/lib/knowledge";
import { useDashboard } from "./provider";
import { Button } from "./ui";

export type OptionRow = {
  key: string;
  staffId: string;
  label: string;
  price: string;
  duration: string;
};

export function rowsFrom(options: PriceOption[] | undefined): OptionRow[] {
  return (options ?? []).map((o) => ({
    key: crypto.randomUUID(),
    staffId: o.staffId ?? "",
    label: o.label ?? "",
    price: o.price,
    duration: o.duration ?? "",
  }));
}

export function optionsFrom(rows: OptionRow[]): PriceOption[] | string {
  const out: PriceOption[] = [];
  for (const row of rows) {
    if (!row.staffId && !row.label.trim())
      return "Pick a team member or name each option.";
    if (!row.price.trim()) return "Add a price for each option.";
    out.push({
      ...(row.staffId
        ? { staffId: row.staffId }
        : { label: row.label.trim().slice(0, 80) }),
      price: row.price.trim().slice(0, 40),
      ...(row.duration.trim()
        ? { duration: row.duration.trim().slice(0, 40) }
        : {}),
    });
  }
  return out;
}

// Price options for a service: one row per team member (or other option).
export function PriceOptionsEditor({
  rows,
  onChange,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
}) {
  const { knowledge } = useDashboard();
  const team = (knowledge.team ?? []).filter((m) => m.active);
  const update = (key: string, patch: Partial<OptionRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="option-rows">
      {rows.map((row, i) => (
        <div className="option-row" key={row.key}>
          <select
            aria-label={`Option ${i + 1}: who or what`}
            value={row.staffId || (row.label ? "__other" : "")}
            onChange={(e) =>
              update(
                row.key,
                e.target.value === "__other"
                  ? { staffId: "", label: row.label || " " }
                  : { staffId: e.target.value, label: "" },
              )
            }
          >
            <option value="">Choose…</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.role ? ` · ${m.role}` : ""}
              </option>
            ))}
            <option value="__other">Other option (e.g. long hair)</option>
          </select>
          {!row.staffId && row.label !== "" && (
            <input
              aria-label={`Option ${i + 1} name`}
              placeholder="Long hair"
              maxLength={80}
              value={row.label.trimStart()}
              onChange={(e) =>
                update(row.key, { label: e.target.value || " " })
              }
            />
          )}
          <input
            aria-label={`Option ${i + 1} price`}
            placeholder="$60"
            maxLength={40}
            value={row.price}
            onChange={(e) => update(row.key, { price: e.target.value })}
          />
          <input
            aria-label={`Option ${i + 1} time`}
            placeholder="45 min"
            maxLength={40}
            value={row.duration}
            onChange={(e) => update(row.key, { duration: e.target.value })}
          />
          <button
            type="button"
            className="dash-icon-button"
            aria-label={`Remove option ${i + 1}`}
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        icon={Plus}
        disabled={rows.length >= 12}
        onClick={() =>
          onChange([
            ...rows,
            {
              key: crypto.randomUUID(),
              staffId: "",
              label: "",
              price: "",
              duration: "",
            },
          ])
        }
      >
        Add a price
      </Button>
      {team.length === 0 && (
        <small>Add your team below the files to pick people here.</small>
      )}
    </div>
  );
}

// Optional: which team members an item is about.
export function AppliesToPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { knowledge } = useDashboard();
  const team = (knowledge.team ?? []).filter((m) => m.active);
  if (team.length === 0) return null;
  return (
    <div className="field">
      <span className="field-label">Applies to</span>
      <div className="staff-chips" role="group" aria-label="Applies to">
        <button
          type="button"
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
        >
          Everyone
        </button>
        {team.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={value.includes(m.id)}
            onClick={() =>
              onChange(
                value.includes(m.id)
                  ? value.filter((id) => id !== m.id)
                  : [...value, m.id],
              )
            }
          >
            {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StaffFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { knowledge } = useDashboard();
  const team = (knowledge.team ?? []).filter((m) => m.active);
  if (team.length === 0) return null;
  return (
    <div
      className="staff-chips staff-filter"
      role="group"
      aria-label="Show items for"
    >
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        Everyone
      </button>
      {team.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={value === m.id}
          onClick={() => onChange(value === m.id ? null : m.id)}
        >
          {m.name}
        </button>
      ))}
    </div>
  );
}

type MemberDraft = {
  id?: string;
  name: string;
  role: string;
  about: string;
  active: boolean;
};

export function TeamPanel() {
  const { knowledge, saveKnowledge, toast } = useDashboard();
  const team = knowledge.team ?? [];
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<MemberDraft>({
    name: "",
    role: "",
    about: "",
    active: true,
  });
  const [error, setError] = useState("");

  function open(member?: TeamMember) {
    setDraft(
      member ? { ...member } : { name: "", role: "", about: "", active: true },
    );
    setError("");
    dialog.current?.showModal();
  }

  function save(next: KnowledgeStore, message: string) {
    saveKnowledge(next);
    toast(message);
    dialog.current?.close();
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) {
      setError("Add a name.");
      return;
    }
    if (
      team.some(
        (m) => m.id !== draft.id && m.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError("Someone on the team already has that name.");
      return;
    }
    const member: TeamMember = {
      id: draft.id ?? `t-${crypto.randomUUID().slice(0, 8)}`,
      name: name.slice(0, 60),
      role: draft.role.trim().slice(0, 80),
      about: draft.about.trim().slice(0, 400),
      active: draft.active,
    };
    const nextTeam = draft.id
      ? team.map((m) => (m.id === draft.id ? member : m))
      : [...team, member];
    save(
      { ...knowledge, team: nextTeam },
      draft.id ? "Team member updated" : `${member.name} added to the team`,
    );
  }

  // Removing someone also removes their prices and tags.
  function remove(id: string) {
    const name = team.find((m) => m.id === id)?.name ?? "Team member";
    save(
      {
        ...knowledge,
        team: team.filter((m) => m.id !== id),
        sources: knowledge.sources.map((s) => {
          if (
            !s.options?.some((o) => o.staffId === id) &&
            !s.staffIds?.includes(id)
          )
            return s;
          const next = { ...s };
          const options = s.options?.filter((o) => o.staffId !== id);
          if (options?.length) next.options = options;
          else delete next.options;
          const staffIds = s.staffIds?.filter((x) => x !== id);
          if (staffIds?.length) next.staffIds = staffIds;
          else delete next.staffIds;
          return next;
        }),
      },
      `${name} removed, with their prices`,
    );
  }

  return (
    <section className="kgroup team-group" aria-labelledby="k-team">
      <header>
        <span className="kgroup-icon" aria-hidden="true">
          <Users size={16} />
        </span>
        <div>
          <h2 id="k-team">Team</h2>
          <small>
            Who works here. Prices and notes can depend on the person.
          </small>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          disabled={team.length >= MAX_TEAM}
          onClick={() => open()}
        >
          Add
        </Button>
      </header>
      {team.length === 0 ? (
        <p className="kgroup-empty">
          Optional. Add your team if prices or services differ by person, for
          example a senior and a junior stylist.
        </p>
      ) : (
        <ul>
          {team.map((m) => (
            <li key={m.id} data-status={m.active ? "approved" : "draft"}>
              <button type="button" className="kitem" onClick={() => open(m)}>
                <strong>
                  {m.name}
                  {!m.active && <span className="kitem-from">· away</span>}
                </strong>
                <span>
                  {[m.role, m.about].filter(Boolean).join(" · ") ||
                    "No role yet"}
                </span>
              </button>
              <span className="team-avatar" aria-hidden="true">
                <UserRound size={15} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialog}
        className="ui-dialog kdialog"
        aria-labelledby="team-dialog-title"
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2 id="team-dialog-title">
            {draft.id ? "Edit team member" : "Add team member"}
          </h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="t-name">Name</label>
              <input
                id="t-name"
                maxLength={60}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="t-role">Role</label>
              <input
                id="t-role"
                maxLength={80}
                placeholder="Senior stylist"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-about">About (optional)</label>
            <textarea
              id="t-about"
              rows={3}
              maxLength={400}
              placeholder="Colour specialist. Speaks Turkish and English."
              value={draft.about}
              onChange={(e) => setDraft({ ...draft, about: e.target.value })}
            />
            <small>Your crew may share this with customers.</small>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            <span aria-hidden="true" />
            Working now (off hides them and their prices from customers)
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ui-dialog-actions">
            {draft.id && (
              <Button
                variant="danger"
                icon={Trash2}
                className="kdialog-delete"
                onClick={() => remove(draft.id!)}
              >
                Remove
              </Button>
            )}
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={Check}>
              Save
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
