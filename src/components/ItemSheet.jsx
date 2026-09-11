import React, { useState, useMemo } from "react";
import { Plus, Minus, X, Sparkles } from "lucide-react";
import { UE, CAT_OF, PLATE_IDS } from "../data/menu.data.js";
import { cents, money } from "../lib/money.js";
import { isCookedToOrder, prepMinutesForItem } from "../lib/prep.js";
import { isModifierAvailable, daysLabel } from "../lib/availability.js";
import { preselectFor } from "../lib/search.js";
import { Group, Option, useSheet } from "./shared.jsx";

/* ---------- ITEM CUSTOMIZE SHEET ---------- */
/* Renders whatever modifier groups the item carries in Clover:
   variant = priced single-select (sizes, flavors that set price)
   flavor  = free single-select
   side    = "Side With Meal", picked twice, some carry an upcharge */
export default function ItemSheet({ item, onClose, onAdd, query = "" }) {
  const variants = item.groups.filter((g) => g.kind === "variant");
  const flavors  = item.groups.filter((g) => g.kind === "flavor");
  const sideG    = item.groups.find((g) => g.kind === "side");

  /* Default each priced group to its cheapest real option — unless the customer
     searched their way here, in which case open on what they searched for.
     Someone who typed "sweet chili salmon" and lands on a sheet defaulted to
     Grilled has been shown the dish and then had it taken away again. */
  /* Today, for the day locks. Read once per sheet: nobody holds one open across
     midnight, and re-deriving it every render would be noise. */
  const today = useMemo(() => new Date(), []);
  const pickable = [...variants, ...flavors];
  /* The reason an option cannot be picked today, or null when it can be. */
  const blockedLabel = (g, m) =>
    (isModifierAvailable(g.gid, m.n, today) ? null : daysLabel(m.days ?? []));

  const [sel, setSel] = useState(() => {
    const init = {};
    pickable.forEach((g) => {
      /* Default to the first option orderable TODAY. Skipping only `oos` would
         open the soup sheet on seafood on a Tuesday, priced for something the
         proxy then refuses. Falling back to any non-oos option keeps a group
         whose every option is off today from defaulting to nothing. */
      let i = g.mods.findIndex((m) => !m.oos && isModifierAvailable(g.gid, m.n, today));
      if (i < 0) i = g.mods.findIndex((m) => !m.oos);
      init[g.gid] = i < 0 ? 0 : i;
    });

    /* A search can land on a flavour that is off today — "seafood soup" on a
       Tuesday. preselectFor skips oos options but knows nothing about days, so
       an unavailable preselection is dropped here and the day-aware default
       stands. Opening on an option the customer cannot choose is worse than
       opening on the default. */
    const usable = {};
    for (const [gid, idx] of Object.entries(preselectFor(item, query))) {
      const g = pickable.find((x) => x.gid === gid);
      const m = g?.mods?.[idx];
      if (m && isModifierAvailable(gid, m.n, today)) usable[gid] = idx;
    }
    return { ...init, ...usable };
  });
  const freeSide = sideG ? Math.max(0, sideG.mods.findIndex((m) => m.p === 0)) : 0;
  const [side1, setSide1] = useState(freeSide);
  const [side2, setSide2] = useState(freeSide);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const variantSum = variants.reduce((t, g) => t + g.mods[sel[g.gid]].p, 0);
  const sideSum = sideG ? sideG.mods[side1].p + sideG.mods[side2].p : 0;
  const unit = cents(item.base + variantSum + sideSum);

  // Exact modifier list for the Clover order push. `mid` is the Clover modifier
  // id when the inventory export carried one; the server resolves by name when
  // it didn't.
  const pick = (g, i) => ({
    gid: g.gid, name: g.mods[i].n, price: g.mods[i].p,
    ...(g.mods[i].mid ? { mid: g.mods[i].mid } : {}),
  });
  const chosen = [
    ...[...variants, ...flavors].map((g) => pick(g, sel[g.gid])),
    ...(sideG ? [pick(sideG, side1), pick(sideG, side2)] : []),
  ];
  const meta = chosen.map((c) => c.name).join(" · ");

  const ue = UE[item.id];
  const saves = ue && unit < ue ? cents(ue - unit) : 0;

  const sheetRef = useSheet(onClose);

  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" ref={sheetRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="serif" id="sheet-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{item.name}</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              {sideG ? "Comes with two sides" : CAT_OF[item.id]}
            </div>
            {/* Said before it goes in the cart, not discovered at checkout. Fish
                and seafood meet the fryer when the ticket lands. */}
            {isCookedToOrder(item.id) && (
              <div className="note-chip" style={{ marginTop: 6, display: "inline-block" }}>
                Cooked to order · about {prepMinutesForItem(item.id)} min
              </div>
            )}
          </div>
          <button className="x-btn" onClick={onClose} aria-label={`Close ${item.name} options`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet-body">
          {variants.map((g) => (
            <Group key={g.gid} label={g.name}>
              {g.mods.filter((m) => !m.oos).map((m) => {
                const i = g.mods.indexOf(m);
                return (
                  <Option key={m.n + i} sel={sel[g.gid] === i}
                    onClick={() => setSel((v) => ({ ...v, [g.gid]: i }))}
                    label={m.n} right={money(m.p)} unavailable={blockedLabel(g, m)} />
                );
              })}
            </Group>
          ))}

          {flavors.map((g) => (
            <Group key={g.gid} label={g.name}>
              {g.mods.map((m, i) => (
                <Option key={m.n + i} sel={sel[g.gid] === i}
                  onClick={() => setSel((v) => ({ ...v, [g.gid]: i }))} label={m.n}
                  unavailable={blockedLabel(g, m)} />
              ))}
            </Group>
          ))}

          {sideG && [[side1, setSide1, "Side 1"], [side2, setSide2, "Side 2"]].map(([val, set, label]) => (
            <Group key={label} label={label}>
              {sideG.mods.map((m, i) => (
                <Option key={m.n + i} sel={val === i} onClick={() => set(i)}
                  label={m.n} right={m.p ? `+${money(m.p)}` : "Included"} />
              ))}
            </Group>
          ))}

          <Group label="Special instructions">
            <input className="field" placeholder="Extra gravy, no pepper, etc."
              aria-label={`Special instructions for ${item.name}`} maxLength={140}
              value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="field-hint">Goes straight to the kitchen ticket.</div>
          </Group>

          {saves > 0 && (
            <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "11px 13px", borderRadius: 13,
              background: "rgba(47,182,168,.10)", marginTop: 4 }}>
              <Sparkles size={16} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
              <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                <strong>{money(saves)} cheaper</strong> than ordering this on Uber Eats
              </div>
            </div>
          )}
        </div>

        <div className="sheet-foot">
          <div className="stepper">
            <button className="step-b" onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty === 1} aria-label="Decrease quantity">
              <Minus size={16} aria-hidden="true" />
            </button>
            <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}
              aria-live="polite" aria-label={`Quantity ${qty}`}>{qty}</span>
            <button className="step-b" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          <button className="pill-btn" style={{ flex: 1 }} onClick={() => {
            onAdd({
              name: item.name, meta, price: unit, qty, note,
              itemId: item.id, cat: CAT_OF[item.id], plate: PLATE_IDS.has(item.id),
              modifiers: chosen,
              save: saves,
            });
          }}>
            Add · {money(unit * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
