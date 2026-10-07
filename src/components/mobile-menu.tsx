"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Menu,
  House,
  History,
  TvMinimal,
  Bookmark,
  Settings2,
} from "lucide-react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetClose,
} from "./ui/sheet";
import { Button } from "./ui/button";
export function MobileMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/", label: "Home", icon: House },
    { href: "/history", label: "History", icon: History },
    { href: "/subscriptions", label: "Subscriptions", icon: TvMinimal },
    { href: "/saved", label: "Watch later", icon: Bookmark },
    { href: "/settings", label: "Settings", icon: Settings2 },
  ];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="mobile-hamburger"
          aria-label="Open navigation"
        >
          <Menu size={21} />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle className="sheet-title">Your library</SheetTitle>
        <nav className="mobile-navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <SheetClose asChild key={href}>
              <Link href={href} prefetch={false}>
                <Icon size={19} />
                {label}
              </Link>
            </SheetClose>
          ))}
          <SheetClose asChild>
            <Link href="/settings">
              <span className="avatar">{username[0]}</span>
              {username}
            </Link>
          </SheetClose>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
