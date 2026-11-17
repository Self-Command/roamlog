import { Badge, Button, EmptyState, PageHeader } from "@roamlog/ui";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface FeaturePlaceholderProps {
  workspaceSlug: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  planned: string[];
}

export function FeaturePlaceholder({
  workspaceSlug,
  eyebrow,
  title,
  description,
  icon: Icon,
  emptyTitle,
  emptyDescription,
  planned,
}: FeaturePlaceholderProps) {
  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
          </Button>
        }
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />
        <aside className="rounded-card border border-hairline-strong bg-surface-1 p-5">
          <Badge tone="slate">WAVE 1 / 2 SCOPE</Badge>
          <h2 className="mt-3 font-serif text-2xl tracking-[-0.025em] text-ink">计划接入</h2>
          <ul className="mt-4 space-y-2.5">
            {planned.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-5 text-muted">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1 shrink-0 rounded-pill bg-accent-blue"
                />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
