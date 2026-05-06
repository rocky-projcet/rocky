import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

import { Input } from "@/shared/ui/input";
import { AccountPopover } from "@/domains/codex/components/account-popover";
import { cn } from "@/shared/lib/utils";
import { HeaderBreadcrumb, isNestedRoute } from "./header-breadcrumb";

function HeaderSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onSearchPage = location.pathname.startsWith("/search");
  const initial = onSearchPage ? searchParams.get("q") ?? "" : "";
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (onSearchPage) {
      setValue(searchParams.get("q") ?? "");
    }
  }, [onSearchPage, searchParams]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    const target = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
    navigate(target);
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-tour="topbar-search"
      className="relative w-full max-w-md"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="작업 / 스킬 / 에이전트를 검색해보세요"
        className="h-9 pl-9"
        aria-label="작업, 스킬, 에이전트 검색"
      />
    </form>
  );
}

export function SiteHeader({ className }: { className?: string }) {
  const location = useLocation();
  const showBreadcrumb = isNestedRoute(location.pathname);

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 border-b bg-background pl-4 pr-4 lg:pr-6",
        className,
      )}
    >
      {showBreadcrumb ? <HeaderBreadcrumb /> : <HeaderSearch />}
      <div className="ml-auto flex items-center gap-2">
        <AccountPopover />
      </div>
    </header>
  );
}
