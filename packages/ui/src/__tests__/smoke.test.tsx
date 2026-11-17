import { render, screen } from "@testing-library/react";
import { Compass, LayoutDashboard, Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  MobileNav,
  PageGlow,
  PageHeader,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Select,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  SidebarContent,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Topbar,
} from "../index";

describe("public UI surface", () => {
  it("renders every primitive and shell without runtime errors", () => {
    render(
      <TooltipProvider>
        <main>
          <PageGlow accent="blue" />
          <PageHeader
            eyebrow="Workspace"
            title="设计系统烟雾测试"
            description="所有共享控件必须能在同一页面中渲染。"
            actions={<Button variant="outline">筛选</Button>}
          />

          <Button variant="ghost">Ghost</Button>
          <IconButton aria-label="创建">
            <Plus aria-hidden="true" />
          </IconButton>

          <Input aria-label="标题" />
          <Textarea aria-label="正文" />
          <Select aria-label="币种" defaultValue="CNY">
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
          </Select>
          <Checkbox aria-label="打包完成" />
          <Switch aria-label="减少动效" />

          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">第一项</TabsTrigger>
            </TabsList>
            <TabsContent value="one">内容</TabsContent>
          </Tabs>

          <Dialog>
            <DialogTrigger asChild>
              <Button>打开 Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Dialog</DialogTitle>
              <DialogDescription>Dialog 描述</DialogDescription>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button>打开 Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Sheet</SheetTitle>
              <SheetDescription>Sheet 描述</SheetDescription>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button>Popover</Button>
            </PopoverTrigger>
            <PopoverContent>浮层内容</PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>菜单项</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button>Tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>提示</TooltipContent>
          </Tooltip>

          <Badge tone="green">已保存</Badge>
          <Avatar name="林墨" />
          <AvatarGroup
            members={[
              { id: "one", name: "林墨" },
              { id: "two", name: "Mira Chen" },
            ]}
          />
          <Progress value={44} aria-label="行程进度" />
          <Separator />
          <Skeleton className="h-3 w-24" />
          <EmptyState title="暂无旅行" description="创建第一趟旅行以开始记录。" />
          <ErrorState retryAction={<Button>重试</Button>} />
          <Pagination page={2} pageCount={5} onPageChange={vi.fn()} />

          <SidebarContent
            workspace={<div>Roamlog Crew</div>}
            primaryNav={[{ href: "/", label: "总览", icon: LayoutDashboard, active: true }]}
            secondaryNav={[{ href: "/trips", label: "旅行", icon: Compass }]}
            nextTrip={<div>下一段旅行</div>}
          />
          <Topbar
            breadcrumbs={[{ label: "Roamlog Crew", href: "/" }, { label: "总览" }]}
            notificationCount={2}
            onNotifications={vi.fn()}
            primaryAction={<Button variant="primary">新旅行</Button>}
          />
          <MobileNav
            items={[
              { href: "/", label: "总览", icon: LayoutDashboard, active: true },
              { href: "/trips", label: "旅行", icon: Compass },
            ]}
          />
        </main>
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: "设计系统烟雾测试" })).toBeInTheDocument();
  });
});
