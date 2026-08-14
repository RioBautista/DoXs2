import { Stethoscope } from 'lucide-react';

type DoctorsPageProps = {
  clientName: string;
};

export function DoctorsPage({ clientName }: DoctorsPageProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-brand-600">
          <Stethoscope className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-950">Doctors / Territory Master List</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            The {clientName} doctor directory will be available here. Alphabetical browsing, search, and incremental loading are being connected to the territory-scoped API.
          </p>
        </div>
      </div>
    </section>
  );
}
