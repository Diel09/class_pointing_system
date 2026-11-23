import { describe, expect, it } from "vitest";
import {
  ALL_SUBJECT_TAB_KEYS,
  CO_TEACHER_SUBJECT_TABS,
  getStudentSubjectTabs,
  getSubjectTabHref,
  resolveSubjectTab,
  STUDENT_SUBJECT_TABS,
  TEACHER_SUBJECT_TABS,
} from "../subject-workspace-tabs";

describe("subject workspace tabs", () => {
  const studentKeys = STUDENT_SUBJECT_TABS.map((tab) => tab.key);
  const coTeacherKeys = CO_TEACHER_SUBJECT_TABS.map((tab) => tab.key);
  const teacherKeys = TEACHER_SUBJECT_TABS.map((tab) => tab.key);

  it("resolves valid tab query params for teacher, co-teacher, and student workspaces", () => {
    expect(resolveSubjectTab("points", studentKeys)).toBe("points");
    expect(resolveSubjectTab("materials", studentKeys)).toBe("materials");
    expect(resolveSubjectTab("materials", coTeacherKeys)).toBe("materials");
    expect(resolveSubjectTab("attendance", studentKeys)).toBe("attendance");
    expect(resolveSubjectTab("roster", teacherKeys)).toBe("roster");
    expect(resolveSubjectTab("roster", ALL_SUBJECT_TAB_KEYS)).toBe("roster");
  });

  it("falls back to the first allowed tab when query value is missing or disallowed", () => {
    expect(resolveSubjectTab(null, studentKeys)).toBe("grades");
    expect(resolveSubjectTab(undefined, teacherKeys)).toBe("grades");
    expect(resolveSubjectTab("unknown", teacherKeys)).toBe("grades");
    expect(resolveSubjectTab("roster", studentKeys)).toBe("grades");
    expect(resolveSubjectTab("roster", coTeacherKeys)).toBe("grades");
  });

  it("builds canonical dedicated routes for each subject workspace section", () => {
    expect(getSubjectTabHref("sub_123", "grades")).toBe("/subjects/sub_123");
    expect(getSubjectTabHref("sub_123", "materials")).toBe(
      "/subjects/sub_123/materials"
    );
    expect(getSubjectTabHref("sub_123", "attendance")).toBe(
      "/subjects/sub_123/attendance"
    );
    expect(getSubjectTabHref("sub_123", "points")).toBe(
      "/subjects/sub_123/points"
    );
    expect(getSubjectTabHref("sub_123", "roster")).toBe(
      "/subjects/sub_123/roster"
    );
  });

  it("preserves full accessible labels alongside concise mobile labels", () => {
    expect(TEACHER_SUBJECT_TABS.map((tab) => tab.label)).toEqual([
      "Standing & Gradebook",
      "Learning Materials",
      "Attendance",
      "Points & Economy",
      "Student Roster",
    ]);
    expect(CO_TEACHER_SUBJECT_TABS.map((tab) => tab.label)).toEqual([
      "Standing & Gradebook",
      "Learning Materials",
      "Attendance",
      "Points & Economy",
    ]);
    expect(STUDENT_SUBJECT_TABS.map((tab) => tab.label)).toEqual([
      "Assessments & Standing",
      "Learning Materials",
      "Points & Rewards",
      "Attendance",
    ]);
  });

  it("hides the Points & Rewards tab for students when points are disabled", () => {
    expect(getStudentSubjectTabs(true).map((tab) => tab.key)).toEqual([
      "grades",
      "materials",
      "points",
      "attendance",
    ]);
    expect(getStudentSubjectTabs(false).map((tab) => tab.key)).toEqual([
      "grades",
      "materials",
      "attendance",
    ]);
  });
});
