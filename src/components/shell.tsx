import Link from "next/link";
import { one } from "@/lib/db";
import {
  Play,
  Search,
  House,
  History,
  TvMinimal,
  Bookmark,
  CircleUserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";
import { MobileMenu } from "./mobile-menu";
import { Appearance, SessionRenewal, SearchShortcut } from "./appearance";
export function Shell({
  user,
  children,
  active = "home",
}: {
  user: User;
  children: ReactNode;
  active?: string;
}) {
  const nav = [
    { href: "/", label: "Home", key: "home", icon: House },
    { href: "/history", label: "History", key: "history", icon: History },
    {
      href: "/subscriptions",
      label: "Subscriptions",
      key: "subscriptions",
      icon: TvMinimal,
    },
    { href: "/saved", label: "Watch later", key: "saved", icon: Bookmark },
  ];
  return (
    <div
      className="app-shell"
      data-user={user.id}
      data-revision={
        one<{ value: string }>(
          "SELECT value FROM settings WHERE key='index_revision'",
        )?.value || "0"
      }
    >
      <header className="app-header">
        <MobileMenu username={user.username} />
        <Link href="/" prefetch={false} className="brand">
          <span className="brand-mark">
            <Play size={16} />
          </span>
          streamvault
        </Link>
        <form action="/search" className="search-field" role="search">
          <Search size={18} />
          <input
            name="q"
            aria-label="Search your library"
            placeholder="Search your library"
            maxLength={200}
          />
          <kbd>/</kbd>
        </form>
        <div className="header-actions">
          <Appearance />
          <Link
            href="/settings"
            prefetch={false}
            className="button button-ghost button-icon header-account"
            aria-label={`Account: ${user.username}`}
            title={user.username}
          >
            <CircleUserRound size={19} />
          </Link>
        </div>
      </header>
      <nav className="desktop-sidebar" aria-label="Main navigation">
        {nav.map((item) => (
          <Link
            href={item.href}
            prefetch={false}
            aria-current={active === item.key ? "page" : undefined}
            key={item.key}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      {["settings", "library", "admin"].includes(active) && (
        <nav className="settings-tabs" aria-label="Settings sections">
          {[
            { href: "/settings", key: "settings", label: "General" },
            { href: "/library", key: "library", label: "Library" },
            ...(user.is_admin
              ? [{ href: "/admin", key: "admin", label: "User management" }]
              : []),
          ].map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
      <main className="main-content">{children}</main>
      <SessionRenewal />
      <SearchShortcut />
    </div>
  );
}
