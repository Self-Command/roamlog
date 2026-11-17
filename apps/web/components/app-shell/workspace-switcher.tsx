"use client";

import type { WorkspaceWithRole } from "@roamlog/contracts";
import { Avatar, type ShellLinkComponent } from "@roamlog/ui";
import { ChevronDown } from "lucide-react";

const DefaultLink = "a" as ShellLinkComponent;

interface WorkspaceSwitcherProps {
  currentWorkspace: WorkspaceWithRole;
  workspaces: WorkspaceWithRole[];
  linkComponent?: ShellLinkComponent;
}

export function WorkspaceSwitcher({
  currentWorkspace,
  workspaces,
  linkComponent: Link = DefaultLink,
}: WorkspaceSwitcherProps) {
  return (
    <details className="group relative">
      <summary
        aria-label="切换工作区"
        className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-control border border-hairline bg-surface-1 px-2.5 py-2 outline-none transition-colors hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas [&::-webkit-details-marker]:hidden"
      >
        <Avatar name={currentWorkspace.name} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">
            {currentWorkspace.name}
          </span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
            {currentWorkspace.role} · {currentWorkspace.plan}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-card border border-hairline-strong bg-surface-2 p-1">
        <p className="px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          切换工作区
        </p>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={`/w/${workspace.slug}`}
            aria-current={workspace.id === currentWorkspace.id ? "page" : undefined}
            className="flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-2 text-xs text-body outline-none hover:bg-surface-1 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
          >
            <Avatar name={workspace.name} size={24} />
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-stone">
              {workspace.role}
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}
