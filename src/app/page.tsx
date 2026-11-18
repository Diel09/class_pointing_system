import { Award, Coins, QrCode } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { PuentoMark } from "@/components/brand/puento-mark";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const HIGHLIGHTS = [
  {
    title: "QR Attendance",
    description:
      "Dynamic rotating QR check-ins with classroom geofence verification.",
    icon: QrCode,
  },
  {
    title: "Merits, Demerits & Sharing",
    description:
      "Per-subject point wallets, peer QR transfers, and teacher-approved rewards.",
    icon: Coins,
  },
  {
    title: "Class Standing (1.00–5.00)",
    description:
      "Teacher-recorded scores, custom weights, and live grade equivalents.",
    icon: Award,
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl mx-auto grid gap-6 lg:gap-8 lg:grid-cols-12 lg:items-center">
        {/* Brand & Welcome Heading */}
        <section className="lg:col-span-7 lg:col-start-1 lg:row-start-1 space-y-5 lg:self-end">
          <div className="flex items-center gap-3">
            <PuentoMark className="h-11 w-11 shadow-sm rounded-xl" />
            <div>
              <p className="text-base font-bold tracking-tight text-slate-900">
                Puento
              </p>
              <p className="text-xs text-slate-500">Classroom Companion</p>
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Welcome to Puento
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-xl leading-relaxed">
              Sign in with your student email to check in to class,
              manage your subject point wallet, and track your live academic
              standing.
            </p>
          </div>
        </section>

        {/* Standard Sign In Card */}
        <section className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2">
          <Suspense
            fallback={
              <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-sm text-slate-500">
                Loading sign-in form...
              </div>
            }
          >
            <LoginForm />
          </Suspense>
        </section>

        {/* Single Responsive Highlights List */}
        <section className="lg:col-span-7 lg:col-start-1 lg:row-start-2 lg:self-start grid gap-3">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="flex items-start gap-3 rounded-2xl bg-white border border-slate-200/90 p-3.5 sm:p-4 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <h2 className="text-xs sm:text-sm font-semibold text-slate-900">
                    {item.title}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
