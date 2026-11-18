import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { PuentoMark } from "@/components/brand/puento-mark";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center px-4 py-10">
      <div className="w-full max-w-md mx-auto space-y-6">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <PuentoMark className="h-10 w-10 shadow-sm rounded-xl" />
          <div>
            <p className="text-base font-bold tracking-tight text-slate-900">
              Puento
            </p>
            <p className="text-[11px] text-slate-500">Classroom Companion</p>
          </div>
        </Link>

        <Suspense
          fallback={
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-sm text-slate-500">
              Loading sign-in form...
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
