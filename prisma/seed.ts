import { PrismaClient } from "@prisma/client";
import { hashLookupToken, hashPassword } from "../src/lib/auth/password";
import {
  DEFAULT_PH_GRADE_SCALE,
  DEFAULT_SINGLE_TERM_CATEGORIES,
} from "../src/lib/grading/default-scale";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Password123!";
const DEV_TEACHER_INVITE = "TEACH-2026";

async function main() {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  // 1. Seed 1 Admin
  const admin = await prisma.user.upsert({
    where: { email: "admin@classpulse.local" },
    update: {
      fullName: "System Administrator",
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      email: "admin@classpulse.local",
      institutionalId: "ADM-0001",
      fullName: "System Administrator",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  // 2. Seed 1 Reusable Teacher Invite Code
  await prisma.teacherInviteCode.upsert({
    where: { codeHash: hashLookupToken(DEV_TEACHER_INVITE) },
    update: {
      label: "Seed Dev Invite",
      maxUses: 25,
    },
    create: {
      codeHash: hashLookupToken(DEV_TEACHER_INVITE),
      label: "Seed Dev Invite",
      maxUses: 25,
      createdByAdminId: admin.id,
    },
  });

  // 3. Seed 2 Active Teachers
  const teacher1 = await prisma.user.upsert({
    where: { email: "teacher1@classpulse.local" },
    update: {
      fullName: "Prof. Elena Santos",
      role: "TEACHER",
      status: "ACTIVE",
    },
    create: {
      email: "teacher1@classpulse.local",
      institutionalId: "EMP-1001",
      fullName: "Prof. Elena Santos",
      passwordHash,
      role: "TEACHER",
      status: "ACTIVE",
    },
  });

  const teacher2 = await prisma.user.upsert({
    where: { email: "teacher2@classpulse.local" },
    update: {
      fullName: "Prof. Marco Reyes",
      role: "TEACHER",
      status: "ACTIVE",
    },
    create: {
      email: "teacher2@classpulse.local",
      institutionalId: "EMP-1002",
      fullName: "Prof. Marco Reyes",
      passwordHash,
      role: "TEACHER",
      status: "ACTIVE",
    },
  });

  // 4. Seed 10 Active Students
  const students = [];
  for (let i = 1; i <= 10; i += 1) {
    const padded = String(i).padStart(4, "0");
    const student = await prisma.user.upsert({
      where: { email: `student${i}@classpulse.local` },
      update: {
        fullName: `Student ${i}`,
        role: "STUDENT",
        status: "ACTIVE",
      },
      create: {
        email: `student${i}@classpulse.local`,
        institutionalId: `2026-${padded}`,
        fullName: `Student ${i}`,
        passwordHash,
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    students.push(student);
  }

  // 5. Seed 1 Active Academic Term
  await prisma.academicTerm.updateMany({
    where: { name: { not: "1st Sem 2026-2027" } },
    data: { isActive: false },
  });

  const activeTerm = await prisma.academicTerm.upsert({
    where: { name: "1st Sem 2026-2027" },
    update: { isActive: true },
    create: {
      name: "1st Sem 2026-2027",
      startDate: new Date("2026-08-10T00:00:00.000Z"),
      endDate: new Date("2026-12-18T23:59:59.000Z"),
      isActive: true,
    },
  });

  // 6. Seed 2 Subjects
  const subject1 = await prisma.subject.upsert({
    where: { inviteCode: "CS101SEC" },
    update: {
      teacherId: teacher1.id,
      termId: activeTerm.id,
    },
    create: {
      teacherId: teacher1.id,
      termId: activeTerm.id,
      code: "CS 101",
      title: "Introduction to Computing",
      section: "BSCS-1A",
      inviteCode: "CS101SEC",
    },
  });

  const subject2 = await prisma.subject.upsert({
    where: { inviteCode: "IT204SEC" },
    update: {
      teacherId: teacher2.id,
      termId: activeTerm.id,
    },
    create: {
      teacherId: teacher2.id,
      termId: activeTerm.id,
      code: "IT 204",
      title: "Information Management",
      section: "BSIT-2B",
      inviteCode: "IT204SEC",
    },
  });

  // 7. Enroll students 1..5 in subject1 and students 1..3 in subject2 (0 pts initial wallets)
  for (const student of students.slice(0, 5)) {
    await prisma.subjectEnrollment.upsert({
      where: {
        subjectId_studentId: {
          subjectId: subject1.id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        subjectId: subject1.id,
        studentId: student.id,
        availableBalance: 0,
        escrowedBalance: 0,
      },
    });
  }

  for (const student of students.slice(0, 3)) {
    await prisma.subjectEnrollment.upsert({
      where: {
        subjectId_studentId: {
          subjectId: subject2.id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        subjectId: subject2.id,
        studentId: student.id,
        availableBalance: 0,
        escrowedBalance: 0,
      },
    });
  }

  // 8. Seed default Merit/Demerit presets for CS 101 if none exist yet
  const existingPresets = await prisma.meritPreset.count({
    where: { subjectId: subject1.id },
  });
  if (existingPresets === 0) {
    await prisma.meritPreset.createMany({
      data: [
        {
          subjectId: subject1.id,
          name: "Active Recitation",
          type: "MERIT",
          pointsDelta: 5,
          description: "Meaningful contribution during class discussion",
        },
        {
          subjectId: subject1.id,
          name: "Helping Classmate",
          type: "MERIT",
          pointsDelta: 3,
          description: "Assisted a peer during lab or group activity",
        },
        {
          subjectId: subject1.id,
          name: "Disruptive Behavior",
          type: "DEMERIT",
          pointsDelta: -5,
          description: "Repeated disruption during lecture",
        },
        {
          subjectId: subject1.id,
          name: "Phone Distraction",
          type: "DEMERIT",
          pointsDelta: -3,
          description: "Unauthorized phone usage during class",
        },
      ],
    });
  }

  // 9. Seed default Reward Catalog items for CS 101 if none exist yet
  const existingRewards = await prisma.rewardItem.count({
    where: { subjectId: subject1.id },
  });
  if (existingRewards === 0) {
    await prisma.rewardItem.createMany({
      data: [
        {
          subjectId: subject1.id,
          name: "Quiz / Exam Score Boost",
          description: "Convert 10 points into +1 raw score on a quiz, activity, or exam.",
          rewardType: "SCORE_BOOST",
          pointCostPerUnit: 10,
          scoreValuePerUnit: 1,
          allowExtraCredit: false,
          maxBoostPerAssessment: 5,
        },
        {
          subjectId: subject1.id,
          name: "Deadline Extension Pass",
          description: "24-hour extension on one lab or homework activity.",
          rewardType: "FIXED_PERK",
          pointCostPerUnit: 25,
          scoreValuePerUnit: 1,
        },
      ],
    });
  }

  // 10. Seed default Grade Categories, Grade Scale, and Sample Assessments for CS 101
  const existingCategories = await prisma.gradeCategory.count({
    where: { subjectId: subject1.id },
  });
  if (existingCategories === 0) {
    for (const cat of DEFAULT_SINGLE_TERM_CATEGORIES) {
      await prisma.gradeCategory.create({
        data: {
          subjectId: subject1.id,
          termKey: cat.termKey,
          name: cat.name,
          categoryType: cat.categoryType,
          weightPct: cat.weightPct,
          aggregationMethod: cat.aggregationMethod,
          targetPointsCap: cat.targetPointsCap,
          sortOrder: cat.sortOrder,
        },
      });
    }
  }

  const existingScale = await prisma.gradeScaleRule.count({
    where: { subjectId: subject1.id },
  });
  if (existingScale === 0) {
    await prisma.gradeScaleRule.createMany({
      data: DEFAULT_PH_GRADE_SCALE.map((rule, index) => ({
        subjectId: subject1.id,
        minPct: rule.minPct,
        maxPct: rule.maxPct,
        gradeEquivalent: rule.gradeEquivalent,
        label: rule.label,
        isPassing: rule.isPassing,
        sortOrder: index,
      })),
    });
  }

  const existingAssessments = await prisma.assessment.count({
    where: { subjectId: subject1.id },
  });
  if (existingAssessments === 0) {
    const quizzesCat = await prisma.gradeCategory.findFirst({
      where: { subjectId: subject1.id, name: "Quizzes" },
    });
    const examsCat = await prisma.gradeCategory.findFirst({
      where: { subjectId: subject1.id, name: "Major Exams" },
    });
    if (quizzesCat && examsCat) {
      await prisma.assessment.createMany({
        data: [
          {
            subjectId: subject1.id,
            categoryId: quizzesCat.id,
            title: "Quiz 1: Computing Fundamentals",
            description: "In-class written quiz covering binary & logic gates.",
            maxScore: 20,
            assessmentDate: new Date("2026-09-05T00:00:00.000Z"),
          },
          {
            subjectId: subject1.id,
            categoryId: examsCat.id,
            title: "Midterm Exam",
            description: "Comprehensive midterm examination.",
            maxScore: 100,
            assessmentDate: new Date("2026-10-15T00:00:00.000Z"),
          },
        ],
      });
    }
  }

  console.log("Seeded Phase 1 baseline:");
  console.log("  Admin:    admin@classpulse.local / Password123!");
  console.log("  Teachers: teacher1@classpulse.local, teacher2@classpulse.local / Password123!");
  console.log("  Students: student1@classpulse.local .. student10@classpulse.local / Password123!");
  console.log(`  Subjects: ${subject1.code} (${subject1.inviteCode}), ${subject2.code} (${subject2.inviteCode})`);
  console.log(`  Teacher Invite Code: ${DEV_TEACHER_INVITE}`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
