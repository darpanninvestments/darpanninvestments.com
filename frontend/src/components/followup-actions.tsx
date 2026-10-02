"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fromLocalInput, inHours, tomorrowAt } from "@/lib/utils";
import { whenOpen } from "./data";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

const OUTCOMES = ["Completed", "No Answer", "Busy", "Call Back", "Rescheduled", "Not Required"];

export function useFollowupInvalidate() {
  const qc = useQueryClient();
  return () => ["/api/followups", "followup-counters", "/api/leads", "lead", "timeline", "dashboard"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Complete a follow-up: outcome + notes + next follow-up + optional status – all in one step. */
function CompleteFollowUpModalBody({ fu, open, onClose }: { fu: Row; open: boolean; onClose: () => void }) {
  const { meta } = useAuth();
  const invalidate = useFollowupInvalidate();
  const [outcome, setOutcome] = useState("Completed");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [statusId, setStatusId] = useState("");
  const [subId, setSubId] = useState("");
  const st = meta?.statuses.find((s) => String(s.id) === statusId);
  const m = useMutation({
    mutationFn: () => api.post(`/api/followups/${fu.id}/complete`, {
      outcome, notes, next_followup_at: fromLocalInput(next), next_action: nextAction || undefined,
      status_id: statusId ? Number(statusId) : undefined, sub_status_id: subId ? Number(subId) : undefined,
    }),
    onSuccess: () => { toast.success("Follow-up completed"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Complete follow-up · ${fu.name || ""}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="success" loading={m.isPending} onClick={() => m.mutate()}>Complete</Button></>}>
      <div className="space-y-4">
        <Field label="Outcome">
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <button key={o} type="button" onClick={() => setOutcome(o)}
                className={`rounded-md border px-2.5 py-1 text-xs ${outcome === o ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-slate-600"}`}>{o}</button>
            ))}
          </div>
          {["No Answer", "Busy", "Call Back"].includes(outcome) && !next && <p className="mt-1 text-xs text-muted">A retry follow-up will be created automatically.</p>}
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Next follow-up">
            <Input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
            <div className="mt-1 flex gap-1"><Button size="xs" variant="outline" onClick={() => setNext(inHours(2))}>+2h</Button>
              <Button size="xs" variant="outline" onClick={() => setNext(tomorrowAt(10))}>Tomorrow</Button>
              <Button size="xs" variant="outline" onClick={() => setNext(inHours(72))}>+3d</Button></div>
          </Field>
          <Field label="Next action"><Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Send brochure" /></Field>
        </div>
        {fu.lead_id && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Update lead status (optional)">
              <Select value={statusId} onChange={(e) => { setStatusId(e.target.value); setSubId(""); }} placeholder="Keep current"
                options={(meta?.statuses || []).map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
            {!!st?.sub_statuses.length && (
              <Field label="Sub-status"><Select value={subId} onChange={(e) => setSubId(e.target.value)} placeholder="Select…"
                options={st.sub_statuses.map((s) => ({ value: s.id, label: s.name }))} /></Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function RescheduleModalBody({ fu, ids, open, onClose }: { fu?: Row; ids?: number[]; open: boolean; onClose: () => void }) {
  const invalidate = useFollowupInvalidate();
  const [due, setDue] = useState(() => tomorrowAt(10));
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => ids?.length
      ? api.post("/api/followups/bulk", { action: "reschedule", ids, due_at: fromLocalInput(due) })
      : api.post(`/api/followups/${fu!.id}/reschedule`, { due_at: fromLocalInput(due), notes: notes || undefined }),
    onSuccess: () => { toast.success("Rescheduled"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={ids?.length ? `Reschedule ${ids.length} follow-ups` : "Reschedule follow-up"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!due} onClick={() => m.mutate()}>Reschedule</Button></>}>
      <div className="space-y-3">
        <Field label="New date & time"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-1"><Button size="xs" variant="outline" onClick={() => setDue(inHours(1))}>+1h</Button>
          <Button size="xs" variant="outline" onClick={() => setDue(inHours(3))}>+3h</Button>
          <Button size="xs" variant="outline" onClick={() => setDue(tomorrowAt(10))}>Tomorrow 10am</Button>
          <Button size="xs" variant="outline" onClick={() => setDue(inHours(168))}>Next week</Button></div>
        {!ids?.length && <Field label="Reason / note"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

export const CompleteFollowUpModal = whenOpen(CompleteFollowUpModalBody);

export const RescheduleModal = whenOpen(RescheduleModalBody);
