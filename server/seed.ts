import { db } from "./db";
import { staffMembers, coverageRecords, providerSchedules, staffUnavailability } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

// Known sample staff names from the original seed — used to detect and remove stale demo data.
const SAMPLE_STAFF_NAMES = [
  'Dr. Sarah Miller', 'Dr. James Chen', 'Dr. Emily Davis', 'NP Mark Wilson',
  'Dr. Robert Taylor', 'Dr. Lisa Anderson', 'PA David Martinez', 'Dr. Jennifer White',
  'Dr. Amanda Thomas', 'Dr. Christopher Lee', 'Dr. Patricia Moore', 'NP Kevin Jackson',
  'Dr. Elizabeth Harris', 'Dr. Brian Clark', 'Dr. Susan Lewis', 'NP Alan Grant',
  'RN Charge Michael Brown', 'RN Charge Karen Wilson', 'RN Charge Sarah Johnson', 'RN Charge David Lee',
  'LVN Jessica Hall', 'LVN Daniel Young', 'LVN Ashley King', 'LVN Ryan Baker',
  'LVN Matthew Scott', 'LVN Sarah Connor', 'LVN Olivia Green', 'LVN Nancy Drew',
  'LVN Clara Barton', 'LVN Emma Hill', 'LVN Noah Carter',
];

// ── Simple seeded random (LCG) for reproducible-but-varied data per DB reset ──
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── April 6-17 weekday dates for conflict/gap seeding ─────────────────────────
const CONFLICT_DATES = [
  '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10',
  '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
];
const OBGYN_GAP_DATES = ['2026-04-09', '2026-04-10', '2026-04-16', '2026-04-17'];

export async function seedInitialData() {
  // Phase 1 — remove any stale demo records from the original seed
  const sampleRows = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(inArray(staffMembers.name, SAMPLE_STAFF_NAMES));

  if (sampleRows.length > 0) {
    console.log(`Removing ${sampleRows.length} sample staff members and all related records...`);
    const sampleIds = sampleRows.map(r => r.id);
    await db.delete(coverageRecords);
    await db.delete(providerSchedules);
    await db.delete(staffUnavailability);
    await db.delete(staffMembers).where(inArray(staffMembers.id, sampleIds));
    console.log("Sample data removed. App is ready for real data.");
  }

  // Phase 2 — seed rich test data only if LVN1 doesn't exist yet (idempotent)
  const existing = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.name, 'LVN1'))
    .limit(1);

  if (existing.length > 0) return; // test data already present

  console.log("[seed] Seeding test data for schedule management (LVN1-LVN35, RNs, Temps)...");

  // Randomise with a seed derived from today so data varies on each DB reset
  const rng = makeRng(new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate());

  // ── 1. Providers ──────────────────────────────────────────────────────────────
  const providerRows = await db.insert(staffMembers).values([
    // Internal/Family Med — Met Home 1
    { name: 'Dr. Rivera', role: 'MD', specialty: 'Internal/Family Med (Met Home 1)', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'Dr. Okafor', role: 'MD', specialty: 'Internal/Family Med (Met Home 1)', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'NP Nguyen', role: 'NP', specialty: 'Internal/Family Med (Met Home 1)', lvnsRequired: 1, employmentType: 'Full-time' },
    // Internal/Family Med — Met Home 2
    { name: 'Dr. Patel', role: 'MD', specialty: 'Internal/Family Med (Met Home 2)', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'Dr. Goldstein', role: 'MD', specialty: 'Internal/Family Med (Met Home 2)', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'PA Reyes', role: 'PA', specialty: 'Internal/Family Med (Met Home 2)', lvnsRequired: 1, employmentType: 'Full-time' },
    // OB/GYN
    { name: 'Dr. Nakamura', role: 'MD', specialty: 'OB/GYN', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'Dr. Santos', role: 'MD', specialty: 'OB/GYN', lvnsRequired: 2, employmentType: 'Full-time' },
    { name: 'NP Flores', role: 'NP', specialty: 'OB/GYN', lvnsRequired: 1, employmentType: 'Full-time' },
    // Pediatrics
    { name: 'Dr. Kim', role: 'MD', specialty: 'Pediatrics', lvnsRequired: 1, employmentType: 'Full-time' },
    { name: 'Dr. Thompson', role: 'MD', specialty: 'Pediatrics', lvnsRequired: 1, employmentType: 'Full-time' },
    // Allergy
    { name: 'Dr. Hassan', role: 'MD', specialty: 'Allergy', lvnsRequired: 1, employmentType: 'Full-time' },
    // Optometry
    { name: 'Dr. Vance', role: 'DO', specialty: 'Optometry', lvnsRequired: 1, employmentType: 'Full-time' },
    // Diabetic Education
    { name: 'NP Castillo', role: 'NP', specialty: 'Diabetic Education', lvnsRequired: 1, employmentType: 'Full-time' },
  ]).returning();

  // Map specialty → provider IDs for quick lookup
  const provsBySpec: Record<string, string[]> = {};
  for (const p of providerRows) {
    (provsBySpec[p.specialty] ??= []).push(p.id);
  }

  // Helper: pick N provider IDs for a specialty (round-robin if needed)
  const provIds = (spec: string) => provsBySpec[spec] ?? [];

  // ── 2. Charge RNs ─────────────────────────────────────────────────────────────
  await db.insert(staffMembers).values([
    { name: 'RN Charge Torres', role: 'RN', specialty: 'Internal/Family Med (Met Home 1)', employmentType: 'Full-time', defaultChargePositionId: 'charge-med-home-1' },
    { name: 'RN Charge Webb', role: 'RN', specialty: 'Internal/Family Med (Met Home 2)', employmentType: 'Full-time', defaultChargePositionId: 'charge-med-home-2' },
    { name: 'RN Charge Bell', role: 'RN', specialty: 'OB/GYN', employmentType: 'Full-time', defaultChargePositionId: 'charge-ob-peds' },
    { name: 'RN Charge Grant', role: 'RN', specialty: 'Allergy', employmentType: 'Full-time', defaultChargePositionId: 'floor-allergy-peds' },
  ]);

  // ── 3. Extra Help RNs (A-J) ───────────────────────────────────────────────────
  const extraRnSpecialties = [
    'Internal/Family Med (Met Home 1)',
    'Internal/Family Med (Met Home 2)',
    'OB/GYN',
    'Pediatrics',
    'Allergy',
  ] as const;

  await db.insert(staffMembers).values(
    ['A','B','C','D','E','F','G','H','I','J'].map((letter, i) => ({
      name: `ExtraRN-${letter}`,
      role: 'RN' as const,
      specialty: extraRnSpecialties[i % extraRnSpecialties.length],
      employmentType: 'Extra Help' as const,
      isFloatPool: i >= 5, // last 5 are float pool
    }))
  );

  // ── 4. Core LVNs (LVN1-LVN30) assigned to providers ─────────────────────────
  // Each LVN is assigned to 1 or 2 providers of matching specialty
  type LvnSeed = {
    name: string;
    specialty: string;
    assignedTo: string[];
    crossTrained?: string[];
    isFloatPool?: boolean;
    employmentType?: string;
  };

  const lvnSeeds: LvnSeed[] = [
    // Internal/Family Med (Met Home 1) — LVN1-LVN10
    { name: 'LVN1',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: provIds('Internal/Family Med (Met Home 1)').slice(0,1) },
    { name: 'LVN2',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: provIds('Internal/Family Med (Met Home 1)').slice(0,1) },
    { name: 'LVN3',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: provIds('Internal/Family Med (Met Home 1)').slice(1,2) },
    { name: 'LVN4',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: provIds('Internal/Family Med (Met Home 1)').slice(1,2) },
    { name: 'LVN5',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: provIds('Internal/Family Med (Met Home 1)').slice(2,3) },
    { name: 'LVN6',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true },
    { name: 'LVN7',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true },
    { name: 'LVN8',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true,
      crossTrained: ['Internal/Family Med (Met Home 2)'] },
    { name: 'LVN9',  specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true,
      crossTrained: ['OB/GYN'] },
    { name: 'LVN10', specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true },
    // Internal/Family Med (Met Home 2) — LVN11-LVN17
    { name: 'LVN11', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: provIds('Internal/Family Med (Met Home 2)').slice(0,1) },
    { name: 'LVN12', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: provIds('Internal/Family Med (Met Home 2)').slice(0,1) },
    { name: 'LVN13', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: provIds('Internal/Family Med (Met Home 2)').slice(1,2) },
    { name: 'LVN14', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: provIds('Internal/Family Med (Met Home 2)').slice(1,2) },
    { name: 'LVN15', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: provIds('Internal/Family Med (Met Home 2)').slice(2,3) },
    { name: 'LVN16', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: [], isFloatPool: true,
      crossTrained: ['Internal/Family Med (Met Home 1)'] },
    { name: 'LVN17', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: [], isFloatPool: true },
    // OB/GYN — LVN18-LVN24
    { name: 'LVN18', specialty: 'OB/GYN', assignedTo: provIds('OB/GYN').slice(0,1) },
    { name: 'LVN19', specialty: 'OB/GYN', assignedTo: provIds('OB/GYN').slice(0,1) },
    { name: 'LVN20', specialty: 'OB/GYN', assignedTo: provIds('OB/GYN').slice(1,2) },
    { name: 'LVN21', specialty: 'OB/GYN', assignedTo: provIds('OB/GYN').slice(1,2) },
    { name: 'LVN22', specialty: 'OB/GYN', assignedTo: provIds('OB/GYN').slice(2,3) },
    { name: 'LVN23', specialty: 'OB/GYN', assignedTo: [], isFloatPool: true },
    { name: 'LVN24', specialty: 'OB/GYN', assignedTo: [], isFloatPool: true,
      crossTrained: ['Pediatrics'] },
    // Pediatrics — LVN25-LVN28
    { name: 'LVN25', specialty: 'Pediatrics', assignedTo: provIds('Pediatrics').slice(0,1) },
    { name: 'LVN26', specialty: 'Pediatrics', assignedTo: provIds('Pediatrics').slice(1,2) },
    { name: 'LVN27', specialty: 'Pediatrics', assignedTo: [], isFloatPool: true },
    { name: 'LVN28', specialty: 'Pediatrics', assignedTo: [], isFloatPool: true,
      crossTrained: ['OB/GYN'] },
    // Allergy — LVN29-LVN30
    { name: 'LVN29', specialty: 'Allergy', assignedTo: provIds('Allergy').slice(0,1) },
    { name: 'LVN30', specialty: 'Allergy', assignedTo: [], isFloatPool: true },
    // Optometry — LVN31-LVN32
    { name: 'LVN31', specialty: 'Optometry', assignedTo: provIds('Optometry').slice(0,1) },
    { name: 'LVN32', specialty: 'Optometry', assignedTo: [], isFloatPool: true },
    // Diabetic Education — LVN33
    { name: 'LVN33', specialty: 'Diabetic Education', assignedTo: provIds('Diabetic Education').slice(0,1) },
    // Cross-trained float pool — LVN34-LVN35
    { name: 'LVN34', specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [], isFloatPool: true,
      crossTrained: ['OB/GYN', 'Pediatrics'] },
    { name: 'LVN35', specialty: 'OB/GYN', assignedTo: [], isFloatPool: true,
      crossTrained: ['Internal/Family Med (Met Home 1)', 'Internal/Family Med (Met Home 2)'] },
  ];

  const lvnRows = await db.insert(staffMembers).values(
    lvnSeeds.map(l => ({
      name: l.name,
      role: 'LVN' as const,
      specialty: l.specialty,
      assignedTo: l.assignedTo,
      crossTrained: l.crossTrained ?? [],
      isFloatPool: l.isFloatPool ?? false,
      employmentType: 'Full-time' as const,
    })) as any
  ).returning();

  // ── 5. Temp/Contract LVNs (TempLVN-1 to TempLVN-5) ──────────────────────────
  await db.insert(staffMembers).values([
    { name: 'TempLVN-1', role: 'LVN', specialty: 'OB/GYN', assignedTo: [],
      crossTrained: ['Pediatrics'], isFloatPool: true, employmentType: 'Per Diem' },
    { name: 'TempLVN-2', role: 'LVN', specialty: 'OB/GYN', assignedTo: [],
      crossTrained: [], isFloatPool: true, employmentType: 'Per Diem' },
    { name: 'TempLVN-3', role: 'LVN', specialty: 'OB/GYN', assignedTo: [],
      crossTrained: ['Internal/Family Med (Met Home 1)'], isFloatPool: true, employmentType: 'Extra Help' },
    { name: 'TempLVN-4', role: 'LVN', specialty: 'Internal/Family Med (Met Home 1)', assignedTo: [],
      crossTrained: ['Internal/Family Med (Met Home 2)'], isFloatPool: true, employmentType: 'Per Diem' },
    { name: 'TempLVN-5', role: 'LVN', specialty: 'Internal/Family Med (Met Home 2)', assignedTo: [],
      crossTrained: ['Internal/Family Med (Met Home 1)'], isFloatPool: true, employmentType: 'Extra Help' },
  ]);

  // ── 6. Double-booking conflicts — 5 assigned LVNs with coverage records ───────
  // Pick the 5 LVNs that are assigned to a provider (non-float)
  const assignedLvns = lvnRows.filter(l => (l.assignedTo as string[]).length > 0);
  const conflictLvns = assignedLvns.slice(0, 5); // LVN1, LVN3, LVN11, LVN13, LVN18

  // Each conflict LVN: coverage record for a DIFFERENT provider on a random conflict date
  const altProviders = providerRows.filter(p =>
    ['Internal/Family Med (Met Home 2)', 'Pediatrics', 'Allergy'].includes(p.specialty)
  );

  const conflictRecords = conflictLvns.map((lvn, i) => {
    const date = CONFLICT_DATES[Math.floor(rng() * CONFLICT_DATES.length)];
    const altProvider = altProviders[i % altProviders.length];
    return {
      date,
      staffId: lvn.id,
      staffName: lvn.name,
      originalSpecialty: lvn.specialty,
      coveredSpecialty: altProvider.specialty,
      providerId: altProvider.id,
      providerName: altProvider.name,
    };
  });
  await db.insert(coverageRecords).values(conflictRecords);

  // ── 7. OB/GYN gaps — unavailability for 3 OB/GYN LVNs on Thu/Fri ─────────────
  const obgynAssignedLvns = lvnRows.filter(
    l => l.specialty === 'OB/GYN' && (l.assignedTo as string[]).length > 0
  ).slice(0, 3);

  if (obgynAssignedLvns.length > 0) {
    const gapRecords = obgynAssignedLvns.flatMap(lvn =>
      OBGYN_GAP_DATES.map(date => ({
        staffId: lvn.id,
        startDate: date,
        endDate: date,
        type: 'Vacation' as const,
        note: 'Seeded Thu/Fri OB/GYN gap for testing',
      }))
    );
    await db.insert(staffUnavailability).values(gapRecords);
  }

  // ── 8. Random unavailability for ~10% of LVNs (3-4) ──────────────────────────
  const lvnsForUnavail = lvnRows.filter(() => rng() < 0.1).slice(0, 4);
  if (lvnsForUnavail.length > 0) {
    const unavailRecords = lvnsForUnavail.map(lvn => {
      const dateIdx = Math.floor(rng() * CONFLICT_DATES.length);
      const date = CONFLICT_DATES[dateIdx];
      return {
        staffId: lvn.id,
        startDate: date,
        endDate: date,
        type: pick(['Vacation', 'Sick', 'FMLA', 'Leave'] as const, rng),
        note: 'Seeded random absence',
      };
    });
    await db.insert(staffUnavailability).values(unavailRecords);
  }

  console.log(`[seed] Done — ${providerRows.length} providers, ${lvnRows.length} LVNs, 14 RNs, 5 TempLVNs, ${conflictRecords.length} conflicts, ${obgynAssignedLvns.length * OBGYN_GAP_DATES.length} gap records.`);
}
