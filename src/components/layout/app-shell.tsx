"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  LogIn,
  LogOut,
  PlusCircle,
  Shield,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PuentoMark } from "@/components/brand/puento-mark";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { InstallPromptBanner } from "@/components/pwa/install-prompt-banner";
import { cn } from "@/lib/utils";

export interface CurrentUserDto {
  id: string;
  email: string;
  institutionalId: string | null;
  fullName: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
}

interface NavItem {
  label: string;
  href: string;
  icon: typeof BookOpen;
}

function getNavItems(role?: CurrentUserDto["role"]): NavItem[] {
  if (role === "ADMIN") {
    return [
      { label: "Classes", href: "/dashboard", icon: BookOpen },
      { label: "Admin", href: "/admin", icon: Shield },
    ];
  }
  if (role === "TEACHER") {
    return [{ label: "My Subjects", href: "/dashboard", icon: BookOpen }];
  }
  if (role === "STUDENT") {
    return [
      { label: "Classes", href: "/dashboard", icon: BookOpen },
      { label: "Join Class", href: "/join", icon: PlusCircle },
    ];
  }
  return [
    { label: "Home", href: "/", icon: BookOpen },
    { label: "Sign In", href: "/login", icon: LogIn },
    { label: "Register", href: "/register", icon: UserCheck },
  ];
}

interface AppShellProps {
  children: ReactNode;
  initialUser?: CurrentUserDto | null;
}

/**
 * Mobile-first PWA application shell with role-aware desktop sidebar and mobile bottom bar.
 */
export function AppShell({ children, initialUser }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: user } = useQuery<CurrentUserDto | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { user?: CurrentUserDto };
      return data.user ?? null;
    },
    initialData: initialUser,
    retry: false,
  });

  const navItems = getNavItems(user?.role);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary navigation"
        className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-slate-200 bg-white"
      >
        <div className="flex items-center gap-2.5 h-16 px-5 border-b border-slate-200">
          <PuentoMark className="h-9 w-9 shadow-sm rounded-xl" />
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-900">
              Puento
            </p>
            <p className="text-[11px] text-slate-500">Classroom Companion</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          {user ? (
            <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/80 space-y-2">
              <div>
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {user.fullName}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {user.role}
                  {user.institutionalId ? ` • ${user.institutionalId}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/80">
              <p className="text-xs font-semibold text-slate-700">
                Not Signed In
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Sign in to access your classes
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-64 pb-20 md:pb-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur px-4 md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <PuentoMark className="h-8 w-8 rounded-lg" />
            <span className="text-sm font-bold tracking-tight">Puento</span>
          </div>
          <div className="hidden md:block">
            <h1 className="text-sm font-semibold text-slate-700">
              Classroom Attendance, Points &amp; Standing
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <NotificationBell />
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">
                  {user.role}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Sign Out"
                  className="md:hidden inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Out</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-5xl w-full mx-auto">
          <InstallPromptBanner />
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur"
      >
        <div
          className={cn(
            "grid h-16",
            navItems.length === 1
              ? "grid-cols-1"
              : navItems.length === 2
              ? "grid-cols-2"
              : "grid-cols-3"
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-indigo-600"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
