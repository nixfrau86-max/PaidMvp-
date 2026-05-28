import React, { useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { Field } from "./_shared";

export default function CreateVPPForm({ onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Tyres",
    image_url: "https://images.unsplash.com/photo-1601411101851-ea0e07766235?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxjYXIlMjB0aXJlJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzc5NjE1NzkzfDA&ixlib=rb-4.1.0&q=85",
    supplier_name: "",
    supplier_cost: 100,
    retail_price: 200,
    customer_price: 150,
    threshold: 20,
    max_participants: 200,
    deadline_hours: 72,
  });
  const [submitting, setSubmitting] = useState(false);

  const upd = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "number" ? +e.target.value : e.target.value,
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/admin/vpps", form);
      toast.success("VPP created");
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="border-2 border-ink bg-white shadow-brut p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4"
      data-testid="create-vpp-form"
    >
      <Field label="Title"><input required value={form.title} onChange={upd("title")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-title" /></Field>
      <Field label="Category"><input value={form.category} onChange={upd("category")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-category" /></Field>
      <Field label="Description" full><textarea value={form.description} onChange={upd("description")} className="w-full border-2 border-ink p-2 font-mono text-sm" rows={2} data-testid="form-description" /></Field>
      <Field label="Image URL" full><input value={form.image_url} onChange={upd("image_url")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-image" /></Field>
      <Field label="Supplier"><input value={form.supplier_name} onChange={upd("supplier_name")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-supplier" /></Field>
      <Field label="Supplier Cost (£)"><input type="number" value={form.supplier_cost} onChange={upd("supplier_cost")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-cost" /></Field>
      <Field label="Retail Price (£)"><input type="number" value={form.retail_price} onChange={upd("retail_price")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-retail" /></Field>
      <Field label="VPP Price (£)"><input type="number" value={form.customer_price} onChange={upd("customer_price")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-price" /></Field>
      <Field label="Threshold"><input type="number" value={form.threshold} onChange={upd("threshold")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-threshold" /></Field>
      <Field label="Max Participants"><input type="number" value={form.max_participants} onChange={upd("max_participants")} className="w-full border-2 border-ink p-2 font-mono text-sm" /></Field>
      <Field label="Deadline (hours)"><input type="number" value={form.deadline_hours} onChange={upd("deadline_hours")} className="w-full border-2 border-ink p-2 font-mono text-sm" /></Field>
      <div className="sm:col-span-2 flex justify-end">
        <button type="submit" disabled={submitting} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut" data-testid="form-submit">
          {submitting ? "Creating..." : "Create VPP"}
        </button>
      </div>
    </form>
  );
}
