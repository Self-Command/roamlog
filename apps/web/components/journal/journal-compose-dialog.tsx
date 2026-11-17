"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  Textarea,
} from "@roamlog/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useDemoStore } from "@/lib/demo-store";

export function JournalComposeDialog({
  open,
  onOpenChange,
  defaultTripId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTripId?: string;
}) {
  const { state, currentRole, addEntry } = useDemoStore();
  const [tripId, setTripId] = useState(defaultTripId ?? state.trips[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [excerpt, setExcerpt] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !location.trim() || !excerpt.trim() || !tripId) return;
    addEntry(
      tripId,
      { title: title.trim(), location: location.trim(), excerpt: excerpt.trim() },
      currentRole,
    );
    setTitle("");
    setLocation("");
    setExcerpt("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="type-eyebrow">NEW JOURNAL ENTRY</p>
          <DialogTitle>写一篇日志</DialogTitle>
          <DialogDescription>
            选择旅行并写下摘要。保存后立即进入本地时间线；Tiptap、草稿与版本历史尚未接入。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormField label="所属旅行">
            <Select value={tripId} onChange={(event) => setTripId(event.target.value)}>
              {state.trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="标题">
            <Input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="今天最想记住的一件事"
            />
          </FormField>
          <FormField label="地点">
            <Input
              required
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="城市 · 街区"
            />
          </FormField>
          <FormField label="正文">
            <Textarea
              required
              value={excerpt}
              onChange={(event) => setExcerpt(event.target.value)}
              placeholder="写下天气、声音和没说完的话。"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="outline">
              <Plus aria-hidden="true" />
              保存日志
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
